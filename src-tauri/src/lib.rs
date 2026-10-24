//! Native side of Horadric Loot Box: finding save folders, safe file writes, backups and game detection.
//! All save parsing happens in the TypeScript core; this layer only moves bytes.

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

mod art;

const SAVE_DIR_NAME: &str = "Diablo II Resurrected";

#[derive(Serialize)]
struct SaveFileEntry {
    name: String,
    path: String,
    size: u64,
    modified: Option<u64>,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn has_ext(path: &Path, exts: &[&str]) -> bool {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    exts.iter().any(|e| name.ends_with(e))
}

fn is_save(path: &Path) -> bool {
    has_ext(path, &[".d2s", ".d2i"])
}

fn is_swpage(path: &Path) -> bool {
    has_ext(path, &[".swpage"])
}

/// A .swpage (D2R Mobile's extra personal-stash pages) is only ever touched as the companion
/// of the character file with the same stem — the game writes it into the character's own
/// folder, next to the .d2s, and it never stands alone.
fn swpage_belongs(path: &Path) -> bool {
    if !is_swpage(path) {
        return false;
    }
    match (path.file_stem(), path.parent()) {
        (Some(stem), Some(parent)) => parent.join(stem).with_extension("d2s").is_file(),
        _ => false,
    }
}

fn is_vault(path: &Path) -> bool {
    has_ext(path, &[".hlb.json", ".hvault.json"])
}

fn entry_for(path: &Path) -> Option<SaveFileEntry> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    Some(SaveFileEntry {
        name: path.file_name()?.to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
        size: meta.len(),
        modified,
    })
}

fn children(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|rd| rd.filter_map(|e| e.ok().map(|e| e.path())).collect())
        .unwrap_or_default()
}

/// Save files directly in `dir`, plus one level of subfolders. The desktop game keeps \`.d2s\` / \`.d2i\`
/// flat in the save folder, but D2R Mobile (iOS) gives each character and the shared stash its own
/// subfolder (e.g. `David/David.d2s`, `ModernSharedStashSoftCoreV2/ModernSharedStashSoftCoreV2.d2i`),
/// so a folder synced from the phone would otherwise look empty.
fn save_files(dir: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = children(dir).into_iter().filter(|p| is_save(p)).collect();
    for sub in children(dir) {
        if sub.is_dir() {
            out.extend(children(&sub).into_iter().filter(|p| is_save(p)));
        }
    }
    out
}

fn contains_saves(dir: &Path) -> bool {
    !save_files(dir).is_empty()
}

/// `drive_c` folders of every Proton (incl. extra Steam libraries), Wine, Lutris, Heroic and Bottles prefix.
fn drive_c_roots() -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_default();
    let mut out = Vec::new();
    let steam_roots = [
        home.join(".local/share/Steam"),
        home.join(".steam/steam"),
        home.join(".steam/root"),
        home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
    ];
    for root in steam_roots.iter() {
        let mut libraries = vec![root.clone()];
        // extra Steam library folders (SD cards, second drives)
        if let Ok(vdf) = fs::read_to_string(root.join("steamapps/libraryfolders.vdf")) {
            for line in vdf.lines() {
                let line = line.trim();
                if line.starts_with("\"path\"") {
                    if let Some(p) = line.split('"').nth(3) {
                        libraries.push(PathBuf::from(p));
                    }
                }
            }
        }
        for lib in libraries {
            for prefix in children(&lib.join("steamapps/compatdata")) {
                out.push(prefix.join("pfx/drive_c"));
            }
        }
    }
    let mut wine_prefixes = vec![home.join(".wine")];
    wine_prefixes.extend(children(&home.join("Games")));
    wine_prefixes.extend(children(&home.join("Games/Heroic/Prefixes")));
    wine_prefixes.extend(children(
        &home.join(".var/app/com.usebottles.bottles/data/bottles/bottles"),
    ));
    wine_prefixes.extend(children(&home.join(".local/share/bottles/bottles")));
    for prefix in wine_prefixes {
        out.push(prefix.join("drive_c"));
    }

    // macOS: Diablo II: Resurrected has no native build, so it runs under a Wine wrapper
    // (CrossOver, Whisky, Wineskin/Porting Kit, or plain Wine in ~/.wine above).
    #[cfg(target_os = "macos")]
    {
        let bottle_roots = [
            home.join("Library/Application Support/CrossOver/Bottles"),
            home.join("Library/Containers/com.isaacmarovitz.Whisky/Bottles"),
            home.join("Library/Application Support/com.isaacmarovitz.Whisky/Bottles"),
        ];
        for root in bottle_roots {
            for bottle in children(&root) {
                out.push(bottle.join("drive_c"));                       // CrossOver / Whisky
                out.push(bottle.join("Contents/Resources/drive_c"));   // Wineskin-style bundle
            }
        }
        for app in children(&home.join("Applications")) {
            out.push(app.join("Contents/Resources/drive_c"));          // Wineskin / Porting Kit wrappers
        }
    }
    out.retain(|p| p.is_dir());
    out.dedup();
    out
}

/// Candidate save folders: Windows "Saved Games", plus Proton / Wine / Lutris / Heroic prefixes on Linux and macOS.
/// On iOS the app's own Documents folder is the workspace (exposed to the Files app via
/// UIFileSharingEnabled + LSSupportsOpeningDocumentsInPlace); saves are copied in/out there.
#[tauri::command]
fn detect_save_folders(app: AppHandle) -> Result<Vec<String>, String> {
    #[cfg(target_os = "ios")]
    {
        return Ok(vec![ios_workspace(&app)?.to_string_lossy().into_owned()]);
    }
    Ok(detect_save_folders_inner())
}

#[cfg(target_os = "ios")]
fn ios_workspace(app: &AppHandle) -> Result<PathBuf, String> {
    let documents = app.path().document_dir().map_err(err)?;
    let workspace = documents.join("save");
    if workspace.is_dir() {
        return Ok(workspace);
    }
    fs::create_dir_all(&documents).map_err(err)?;
    // Older builds opened Documents itself. Copy any saves and companions into
    // the new visible `save` folder, leaving the originals untouched.
    let legacy_saves: Vec<PathBuf> = children(&documents)
        .into_iter()
        .filter(|p| is_save(p))
        .collect();
    let folders: Vec<PathBuf> = children(&documents)
        .into_iter()
        .filter(|p| {
            p.is_dir()
                && p.file_name().and_then(|n| n.to_str()) != Some("exports")
                && p.file_name().and_then(|n| n.to_str()) != Some("HLB Backups")
                && contains_saves(p)
        })
        .collect();
    if legacy_saves.is_empty() && folders.is_empty() {
        fs::create_dir_all(&workspace).map_err(err)?;
        return Ok(workspace);
    }
    let staged = documents.join(".save-migration");
    fs::create_dir_all(&staged).map_err(err)?;
    let copied = (|| -> Result<(), String> {
        for src in children(&documents).into_iter().filter(|p| p.is_file()) {
            let stem = src.file_stem();
            if is_save(&src) || legacy_saves.iter().any(|s| s.file_stem() == stem) {
                fs::copy(&src, staged.join(src.file_name().ok_or("bad file name")?)).map_err(err)?;
            }
        }
        for folder in folders {
            let destination = staged.join(folder.file_name().ok_or("bad folder name")?);
            fs::create_dir_all(&destination).map_err(err)?;
            for src in children(&folder).into_iter().filter(|p| p.is_file()) {
                fs::copy(&src, destination.join(src.file_name().ok_or("bad file name")?))
                    .map_err(err)?;
            }
        }
        fs::rename(&staged, &workspace).map_err(err)?;
        Ok(())
    })();
    if copied.is_err() {
        let _ = fs::remove_dir_all(&staged);
    }
    copied.map(|()| workspace)
}

#[cfg(target_os = "ios")]
extern "C" {
    fn hlb_sync_save_folder(
        mode: i32,
        workspace: *const std::ffi::c_char,
        callback: extern "C" fn(*mut std::ffi::c_void, *const std::ffi::c_char),
        context: *mut std::ffi::c_void,
    );
}

#[cfg(target_os = "ios")]
extern "C" fn ios_sync_callback(context: *mut std::ffi::c_void, result: *const std::ffi::c_char) {
    let sender = unsafe { Box::from_raw(context as *mut std::sync::mpsc::Sender<String>) };
    let value = if result.is_null() {
        "error:文件选择器没有返回结果".to_string()
    } else {
        unsafe { std::ffi::CStr::from_ptr(result) }
            .to_string_lossy()
            .into_owned()
    };
    let _ = sender.send(value);
}

#[cfg(target_os = "ios")]
async fn ios_sync(app: AppHandle, mode: i32) -> Result<Option<String>, String> {
    let workspace = if mode == 2 {
        ios_art_path(&app)?
    } else {
        ios_workspace(&app)?
    };
    let path = std::ffi::CString::new(workspace.to_string_lossy().as_bytes()).map_err(err)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (sender, receiver) = std::sync::mpsc::channel();
        let context = Box::into_raw(Box::new(sender)) as *mut std::ffi::c_void;
        unsafe { hlb_sync_save_folder(mode, path.as_ptr(), ios_sync_callback, context) };
        let value: String = receiver.recv().map_err(err)?;
        if value == "cancel" {
            Ok(None)
        } else if let Some(result) = value.strip_prefix("ok:") {
            Ok(Some(result.to_string()))
        } else {
            Err(value.strip_prefix("error:").unwrap_or(&value).to_string())
        }
    })
    .await
    .map_err(err)?
}

#[tauri::command]
async fn ios_import_saves(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "ios")]
    { return ios_sync(app, 0).await; }
    #[cfg(not(target_os = "ios"))]
    { let _ = app; Err("iOS only".into()) }
}

#[tauri::command]
async fn ios_export_saves(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "ios")]
    { return ios_sync(app, 1).await; }
    #[cfg(not(target_os = "ios"))]
    { let _ = app; Err("iOS only".into()) }
}

#[cfg(target_os = "ios")]
fn ios_art_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().document_dir().map_err(err)?.join("resources"))
}

#[tauri::command]
fn ios_art_folder(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "ios")]
    {
        let path = ios_art_path(&app)?;
        return Ok(path.is_dir().then(|| path.to_string_lossy().into_owned()));
    }
    #[cfg(not(target_os = "ios"))]
    { let _ = app; Ok(None) }
}

#[tauri::command]
async fn ios_import_art(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "ios")]
    { return ios_sync(app, 2).await; }
    #[cfg(not(target_os = "ios"))]
    { let _ = app; Err("iOS only".into()) }
}

/// Desktop candidate folders (AppHandle-free, so tests can call it).
fn detect_save_folders_inner() -> Vec<String> {
    let mut found: Vec<PathBuf> = Vec::new();
    let home = dirs::home_dir().unwrap_or_default();

    // Windows (and anything that sets USERPROFILE)
    if let Ok(profile) = std::env::var("USERPROFILE") {
        found.push(Path::new(&profile).join("Saved Games").join(SAVE_DIR_NAME));
    }
    found.push(home.join("Saved Games").join(SAVE_DIR_NAME));
    // macOS
    found.push(
        home.join("Library")
            .join("Application Support")
            .join(SAVE_DIR_NAME),
    );

    // Steam/Proton, Wine, Lutris, Heroic and Bottles prefixes on Linux / SteamOS / macOS
    for drive_c in drive_c_roots() {
        for user in children(&drive_c.join("users")) {
            found.push(user.join("Saved Games").join(SAVE_DIR_NAME));
        }
    }

    let mut out: Vec<String> = Vec::new();
    for p in found {
        if p.is_dir() && contains_saves(&p) {
            let s = p.to_string_lossy().into_owned();
            if !out.contains(&s) {
                out.push(s);
            }
        }
    }
    out
}

#[tauri::command]
fn list_saves(folder: String) -> Result<Vec<SaveFileEntry>, String> {
    let dir = PathBuf::from(folder);
    if !dir.is_dir() {
        return Err(format!("{} is not a folder", dir.display()));
    }
    let mut out: Vec<SaveFileEntry> = save_files(&dir)
        .iter()
        .filter_map(|p| entry_for(p))
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
fn read_file(path: String) -> Result<Vec<u8>, String> {
    let p = PathBuf::from(&path);
    if !is_save(&p) && !swpage_belongs(&p) {
        return Err("Only .d2s and .d2i files (and a character's .swpage companion) can be read".into());
    }
    fs::read(&p).map_err(err)
}

/// Writes to `<file>.hlb-tmp`, flushes to disk, then renames over the original.
fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension(format!(
        "{}.hlb-tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("dat")
    ));
    {
        let mut f = fs::File::create(&tmp).map_err(err)?;
        f.write_all(data).map_err(err)?;
        f.sync_all().map_err(err)?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not replace {}: {}", path.display(), e)
    })
}

#[tauri::command]
fn write_file_atomic(path: String, data: Vec<u8>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if is_swpage(&p) {
        // the extra-pages sidecar may be created on first use (the game creates it the same
        // way, on the first page turn), but only ever next to its own character file
        if !swpage_belongs(&p) {
            return Err("A .swpage can only be written next to its character file".into());
        }
        return atomic_write(&p, &data);
    }
    if !is_save(&p) {
        return Err("Only .d2s and .d2i files can be written".into());
    }
    if !p.exists() {
        return Err(format!(
            "{} no longer exists; refusing to create a new save",
            p.display()
        ));
    }
    atomic_write(&p, &data)
}

/// iOS: writes an exported .d2i into <Documents>/exports/ and returns the path.
/// Documents is app-owned, so no security-scoped URL dance is needed; the user
/// moves the file via the Files app ("考出"). The desktop app exports through
/// browser downloads instead, so this command is iOS-only.
#[tauri::command]
fn export_item(app: AppHandle, name: String, data: Vec<u8>) -> Result<String, String> {
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, name, data);
        return Err("export_item is iOS-only".into());
    }
    #[cfg(target_os = "ios")]
    {
        let safe: String = name
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '_' || *c == '-')
            .collect();
        let safe = if safe.is_empty() {
            "item.d2i".to_string()
        } else {
            safe
        };
        let dir = app.path().document_dir().map_err(err)?.join("exports");
        fs::create_dir_all(&dir).map_err(err)?;
        let path = dir.join(safe);
        // atomic_write derives its temp name from the target (no shared ".tmp-export") and syncs
        atomic_write(&path, &data)?;
        Ok(path.to_string_lossy().into_owned())
    }
}

fn data_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(err)?.join(sub);
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

/// How many folder snapshots are kept. Deletion backups (`*_deleted*`) are never pruned.
const BACKUP_SNAPSHOTS: usize = 30;

/// Where snapshots live: on iOS inside Documents, so the user can see and restore them from the
/// Files app; elsewhere in the app data dir (desktop reveals it via `reveal_backups`).
fn backups_root(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "ios")]
    {
        let dir = app.path().document_dir().map_err(err)?.join("HLB Backups");
        fs::create_dir_all(&dir).map_err(err)?;
        Ok(dir)
    }
    #[cfg(not(target_os = "ios"))]
    {
        data_dir(app, "backups")
    }
}

/// One entry in `manifest.json` next to the snapshots.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct BackupManifestEntry {
    dir: String,
    kind: String,
    checksum: String,
    files: usize,
    bytes: u64,
}

/// Result of a `backup_folder` call: `skipped` means no new snapshot was written (the folder was
/// empty/missing, or its content is identical to the newest surviving snapshot).
#[derive(serde::Serialize)]
struct BackupResult {
    skipped: bool,
    dir: Option<String>,
    files: usize,
    bytes: u64,
}

/// Every copyable file under `folder` as (relative path, absolute path), sorted by relative path.
/// Skips symlinks (a loop in a save folder must never hang a backup) and half-written `*.hlb-tmp`
/// files. Directories themselves are not listed: restoring a snapshot recreates them from the files.
fn folder_tree(folder: &Path) -> Vec<(PathBuf, PathBuf)> {
    let mut out = Vec::new();
    let mut stack = vec![folder.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in children(&dir) {
            let ft = entry.symlink_metadata().map(|m| m.file_type()).ok();
            match ft {
                Some(t) if t.is_symlink() => {}
                Some(t) if t.is_dir() => stack.push(entry),
                Some(t) if t.is_file() => {
                    if entry.extension().and_then(|e| e.to_str()) == Some("hlb-tmp") {
                        continue;
                    }
                    if let Ok(rel) = entry.strip_prefix(folder) {
                        out.push((rel.to_path_buf(), entry));
                    }
                }
                _ => {}
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// Dedupe-only checksum over a folder tree (not integrity, not security): FNV-1a 64 over each
/// file's relative path, a separator, its length, and its bytes, in path order. Hand-rolled so the
/// value is stable across Rust versions (std's DefaultHasher makes no such promise) and no new
/// dependency is needed. A collision only costs an extra snapshot, never data loss.
fn folder_checksum(tree: &[(PathBuf, PathBuf)]) -> Result<(String, usize, u64), String> {
    let mut hash: u64 = 0xcbf29ce484222325;
    let mut bytes: u64 = 0;
    for (rel, abs) in tree {
        for b in rel.to_string_lossy().as_bytes().iter().chain(std::iter::once(&0xff)) {
            hash ^= *b as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        let data = fs::read(abs).map_err(err)?;
        for b in (data.len() as u64).to_le_bytes() {
            hash ^= b as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        for b in &data {
            hash ^= *b as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        bytes += data.len() as u64;
    }
    Ok((format!("{:016x}", hash), tree.len(), bytes))
}

fn manifest_path(root: &Path) -> PathBuf {
    root.join("manifest.json")
}

fn read_manifest(root: &Path) -> Vec<BackupManifestEntry> {
    fs::read_to_string(manifest_path(root))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Atomic manifest write (temp file + rename) so a crash never leaves a half-written manifest.
fn write_manifest(root: &Path, entries: &[BackupManifestEntry]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(entries).map_err(err)?;
    let tmp = manifest_path(root).with_extension("json.tmp");
    fs::write(&tmp, text).map_err(err)?;
    fs::rename(&tmp, manifest_path(root)).map_err(err)?;
    Ok(())
}

/// The newest manifest entry whose snapshot directory still exists: the dedupe baseline. A
/// checksum alone is not enough — if that snapshot was deleted by hand, skipping would leave no
/// copy of this content anywhere.
fn dedupe_baseline(root: &Path, entries: &[BackupManifestEntry]) -> Option<String> {
    entries.iter().rev().find(|e| root.join(&e.dir).is_dir()).map(|e| e.checksum.clone())
}

fn is_snapshot_dir(d: &Path) -> bool {
    d.is_dir() && !d.file_name().map(|n| n.to_string_lossy().contains("_deleted")).unwrap_or(true)
}

/// Keeps only the newest `BACKUP_SNAPSHOTS` snapshot dirs (their names sort by time) and rewrites
/// the manifest to the survivors. Deletion backups (`*_deleted*`) are never touched. Legacy
/// flat-file backup dirs from the per-file scheme share the stamp format, so they age out here too.
fn prune_snapshots(root: &Path, entries: &mut Vec<BackupManifestEntry>) {
    let mut dirs: Vec<PathBuf> = children(root).into_iter().filter(|d| is_snapshot_dir(d)).collect();
    dirs.sort();
    dirs.reverse(); // newest first
    for d in dirs.iter().skip(BACKUP_SNAPSHOTS) {
        let _ = fs::remove_dir_all(d);
    }
    let surviving: std::collections::HashSet<String> = dirs
        .iter()
        .take(BACKUP_SNAPSHOTS)
        .filter_map(|d| d.file_name().map(|n| n.to_string_lossy().into_owned()))
        .collect();
    entries.retain(|e| surviving.contains(&e.dir));
}

/// Snapshots a whole save folder into a timestamped directory under the backups root, preserving
/// the tree. Skips (without error) when the folder is empty/missing or its content is identical
/// to the newest surviving snapshot. Import snapshots get a `-before-import` suffix so the
/// pre-import state is easy to find.
#[tauri::command]
fn backup_folder(app: AppHandle, folder: String, kind: String) -> Result<BackupResult, String> {
    let src = PathBuf::from(&folder);
    if !src.is_dir() {
        return Ok(BackupResult { skipped: true, dir: None, files: 0, bytes: 0 });
    }
    let root = backups_root(&app)?;
    if root.starts_with(&src) {
        return Err("Backup destination is inside the folder being backed up".into());
    }
    let tree = folder_tree(&src);
    if tree.is_empty() {
        return Ok(BackupResult { skipped: true, dir: None, files: 0, bytes: 0 });
    }
    let (checksum, files, bytes) = folder_checksum(&tree)?;
    let mut entries = read_manifest(&root);
    if dedupe_baseline(&root, &entries).as_deref() == Some(checksum.as_str()) {
        return Ok(BackupResult { skipped: true, dir: None, files, bytes });
    }
    // milliseconds: two snapshots within one second must not share a folder. Fixed width, so
    // folder names still sort by time.
    let base = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S_%3f").to_string();
    let stem = if kind == "import" { format!("{}-before-import", base) } else { base };
    let mut name = stem.clone();
    let mut dir = root.join(&name);
    let mut n = 2;
    while dir.exists() {
        name = format!("{}-{}", stem, n);
        dir = root.join(&name);
        n += 1;
    }
    let copied = (|| -> Result<(), String> {
        for (rel, abs) in &tree {
            let dest = dir.join(rel);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(err)?;
            }
            fs::copy(abs, &dest).map_err(|e| format!("Backup of {} failed: {}", abs.display(), e))?;
        }
        Ok(())
    })();
    if let Err(e) = copied {
        let _ = fs::remove_dir_all(&dir);
        return Err(e);
    }
    entries.push(BackupManifestEntry { dir: name, kind, checksum, files, bytes });
    prune_snapshots(&root, &mut entries);
    write_manifest(&root, &entries)?;
    Ok(BackupResult { skipped: false, dir: Some(dir.to_string_lossy().into_owned()), files, bytes })
}

/// Vaults live in a folder next to the character saves, so backing up the save folder backs them up too.
const VAULT_DIR: &str = "HoradricLootBox-Vaults";
const MOVED_NOTE: &str = "MOVED-TO-SAVE-FOLDER.txt";

/// The vault folder inside a save folder. The first time, vaults kept in the app data folder by older
/// versions are copied in (the originals stay, with a note saying where they went).
fn vault_dir(app: &AppHandle, save_folder: &str) -> Result<PathBuf, String> {
    let save = PathBuf::from(save_folder);
    if !save.is_dir() {
        return Err(format!("Save folder {} not found", save.display()));
    }
    let dir = save.join(VAULT_DIR);
    fs::create_dir_all(&dir).map_err(err)?;
    if let Ok(old) = app.path().app_data_dir().map(|d| d.join("vaults")) {
        migrate_vaults(&old, &dir);
    }
    Ok(dir)
}

fn migrate_vaults(old: &Path, new: &Path) {
    if !old.is_dir() || old.join(MOVED_NOTE).exists() {
        return;
    }
    let files: Vec<PathBuf> = children(old).into_iter().filter(|p| is_vault(p)).collect();
    if files.is_empty() {
        return;
    }
    let mut ok = true;
    for f in &files {
        let dst = new.join(f.file_name().unwrap());
        if !dst.exists() && fs::copy(f, &dst).is_err() {
            ok = false;
        }
    }
    if ok {
        let _ = fs::write(
            old.join(MOVED_NOTE),
            format!(
                "Horadric Loot Box 1.0 keeps vaults next to your saves, in:\n{}\n\nThe files here were copied there and are no longer used. You can delete this folder.\n",
                new.display()
            ),
        );
    }
}

#[tauri::command]
fn list_vaults(app: AppHandle, folder: String) -> Result<Vec<SaveFileEntry>, String> {
    let dir = vault_dir(&app, &folder)?;
    Ok(children(&dir)
        .iter()
        .filter(|p| is_vault(p))
        .filter_map(|p| entry_for(p))
        .collect())
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !is_vault(&p) {
        return Err("Only vault files can be read as text".into());
    }
    fs::read_to_string(p).map_err(err)
}

#[tauri::command]
fn write_vault(
    app: AppHandle,
    folder: String,
    name: String,
    text: String,
    existing_path: Option<String>,
) -> Result<String, String> {
    let path = match existing_path {
        Some(p) if is_vault(Path::new(&p)) => PathBuf::from(p),
        _ => {
            let safe: String = name
                .chars()
                .map(|c| {
                    if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                        c
                    } else {
                        '_'
                    }
                })
                .collect();
            let dir = vault_dir(&app, &folder)?;
            let mut p = dir.join(format!("{}.hlb.json", safe.trim()));
            let mut n = 2;
            while p.exists() {
                p = dir.join(format!("{} ({}).hlb.json", safe.trim(), n));
                n += 1;
            }
            p
        }
    };
    if path.exists() {
        // keep one previous copy of every vault
        let _ = fs::copy(&path, path.with_extension("json.bak"));
    }
    atomic_write(&path, text.as_bytes())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn is_game_running() -> bool {
    // iOS sandbox: sysinfo can't see other processes, and the game can't run alongside anyway.
    #[cfg(target_os = "ios")]
    return false;
    // Called on every save: a full process-table refresh each time is pure waste, so cache for a few seconds.
    static CACHE: std::sync::Mutex<Option<(std::time::Instant, bool)>> = std::sync::Mutex::new(None);
    if let Ok(c) = CACHE.lock() {
        if let Some((at, v)) = *c {
            if at.elapsed() < std::time::Duration::from_secs(3) {
                return v;
            }
        }
    }
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let running = sys.processes().values().any(|p| {
        let name = p.name().to_string_lossy().to_ascii_lowercase();
        // Windows runs it as D2R.exe. Under Wine/CrossOver on macOS the process can show up as
        // the translated name, the full game name, or through the wrapper, so match loosely.
        let stem = name.strip_suffix(".exe").unwrap_or(&name);
        stem == "d2r"
            || name.contains("diablo ii resurrected")
            || (name.contains("diablo") && name.contains("resurrected"))
    });
    if let Ok(mut c) = CACHE.lock() {
        *c = Some((std::time::Instant::now(), running));
    }
    running
}

#[tauri::command]
fn reveal_backups(app: AppHandle) -> Result<(), String> {
    // iOS: spawning `open`/`xdg-open` is banned in the sandbox.
    #[cfg(target_os = "ios")]
    return Err("Not supported on iOS: open the HLB Backups folder in the Files app.".into());
    let dir = backups_root(&app)?;
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let cmd = "xdg-open";
    std::process::Command::new(cmd)
        .arg(dir)
        .spawn()
        .map_err(err)?;
    Ok(())
}

/// Game files kept next to a character (.d2s) that belong to it.
const CHARACTER_EXTS: &[&str] = &[
    "d2s", "key", "ctl", "map", "ma0", "ma1", "ma2", "ma3", "ma4", "d2x",
];

/// Deletes a character's .d2s and its companion files. A copy goes to the backups folder first, so a mistake
/// can still be undone by hand. Refused while the game is running.
/// Copies a character's files into `backup_dir`, then deletes them from the save folder. Returns what was deleted.
fn delete_character_files(src: &Path, backup_dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !has_ext(src, &[".d2s"]) {
        return Err("Only character (.d2s) files can be deleted".into());
    }
    if !src.is_file() {
        return Err(format!("{} no longer exists", src.display()));
    }
    let stem = src.file_stem().ok_or("bad file name")?.to_os_string();
    let parent = src.parent().ok_or("bad path")?.to_path_buf();
    let files: Vec<PathBuf> = children(&parent)
        .into_iter()
        .filter(|p| p.is_file() && p.file_stem() == Some(stem.as_os_str()))
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(|e| CHARACTER_EXTS.contains(&e.to_ascii_lowercase().as_str()))
                .unwrap_or(false)
        })
        .collect();
    fs::create_dir_all(backup_dir).map_err(err)?;
    for f in &files {
        fs::copy(f, backup_dir.join(f.file_name().unwrap()))
            .map_err(|e| format!("Backup of {} failed: {}", f.display(), e))?;
    }
    for f in &files {
        fs::remove_file(f).map_err(|e| format!("Could not delete {}: {}", f.display(), e))?;
    }
    Ok(files)
}

/// Deletes a character's .d2s and its companion files. A copy goes to the backups folder first, so a mistake
/// can still be undone by hand. Refused while the game is running.
#[tauri::command]
fn delete_character(app: AppHandle, path: String) -> Result<String, String> {
    if is_game_running() {
        return Err(
            "Diablo II: Resurrected is running. Close it before deleting a character.".into(),
        );
    }
    let src = PathBuf::from(&path);
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let dir = backups_root(&app)?.join(format!("{}_deleted_{}", stamp, stem));
    delete_character_files(&src, &dir)?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Deletes a vault file (and its .bak) from the vaults folder, keeping a copy in the backups folder.
#[tauri::command]
fn delete_vault(app: AppHandle, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !is_vault(&p) {
        return Err("Only vault files can be deleted here".into());
    }
    let in_vault_dir = p.parent().and_then(|d| d.file_name()).map(|n| n == VAULT_DIR).unwrap_or(false);
    if !in_vault_dir {
        return Err("That vault isn't in a Horadric Loot Box vaults folder".into());
    }
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let dir = backups_root(&app)?.join(format!("{}_deleted_vault", stamp));
    fs::create_dir_all(&dir).map_err(err)?;
    let name = p.file_name().ok_or("bad file name")?;
    fs::copy(&p, dir.join(name)).map_err(|e| format!("Backup failed: {}", e))?;
    fs::remove_file(&p).map_err(|e| format!("Could not delete {}: {}", p.display(), e))?;
    let _ = fs::remove_file(p.with_extension("json.bak"));
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn art_detect_installs() -> Vec<String> {
    // iOS: there is no drive_c to scan. Artwork comes from a resource pack the
    // user copies into Documents (SPEC §8).
    #[cfg(target_os = "ios")]
    return Vec::new();
    art::detect_installs(&drive_c_roots())
}

/// The app's identifier before it was renamed from Horadric Vault.
const OLD_IDENTIFIER: &str = "com.horadricvault.app";
const IDENTIFIER: &str = "com.horadriclootbox.app";

/// Copies a folder tree, skipping anything that can't be copied (e.g. locked webview files).
fn copy_tree(from: &Path, to: &Path) {
    if fs::create_dir_all(to).is_err() {
        return;
    }
    for entry in fs::read_dir(from).into_iter().flatten().flatten() {
        let (src, dst) = (entry.path(), to.join(entry.file_name()));
        if src.is_dir() {
            copy_tree(&src, &dst);
        } else if !dst.exists() {
            let _ = fs::copy(&src, &dst);
        }
    }
}

/// First run after the rename: copy the old app folders (vaults, backups, and the webview storage that holds
/// the settings) to the new identifier's folders. The old folders are left in place untouched.
fn migrate_from_old_name() {
    for base in [dirs::data_dir(), dirs::data_local_dir()].into_iter().flatten() {
        let (old, new) = (base.join(OLD_IDENTIFIER), base.join(IDENTIFIER));
        if old.is_dir() && !new.exists() {
            copy_tree(&old, &new);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // before the webview starts, so its storage (settings) is carried over too
    migrate_from_old_name();
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    #[cfg(not(target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .manage(art::ArtState::default())
        .register_asynchronous_uri_scheme_protocol("hlbart", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            std::thread::spawn(move || {
                let state = app.state::<art::ArtState>();
                responder.respond(art::protocol_response(&state, &path));
            });
        })
        .invoke_handler(tauri::generate_handler![
            detect_save_folders,
            list_saves,
            read_file,
            write_file_atomic,
            backup_folder,
            list_vaults,
            read_text,
            write_vault,
            is_game_running,
            reveal_backups,
            export_item,
            ios_import_saves,
            ios_export_saves,
            ios_art_folder,
            ios_import_art,
            art_detect_installs,
            delete_character,
            delete_vault,
            art::art_open,
            art::art_close,
            art::art_probe
        ])
        .run(tauri::generate_context!())
        .expect("error while running Horadric Loot Box");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_saves_flat_or_in_subfolders() {
        // Desktop layout: .d2s / .d2i directly in the folder.
        let flat = temp_dir("flat-saves");
        fs::write(flat.join("Hero.d2s"), "x").unwrap();
        fs::write(flat.join("SharedStashSoftCoreV2.d2i"), "x").unwrap();
        assert_eq!(save_files(&flat).len(), 2);

        // D2R Mobile layout: a subfolder per character / stash, plus stray files to ignore.
        let nested = temp_dir("nested-saves");
        fs::create_dir_all(nested.join("David")).unwrap();
        fs::create_dir_all(nested.join("ModernSharedStashSoftCoreV2")).unwrap();
        fs::create_dir_all(nested.join("Settings")).unwrap();
        fs::write(nested.join("David/David.d2s"), "x").unwrap();
        fs::write(nested.join("David/David.ctl"), "x").unwrap();
        fs::write(nested.join("David/David.d2s.meta"), "x").unwrap();
        fs::write(nested.join("David/David.swpouch"), "x").unwrap();
        fs::write(nested.join("ModernSharedStashSoftCoreV2/ModernSharedStashSoftCoreV2.d2i"), "x").unwrap();
        fs::write(nested.join("Settings/Settings.json"), "x").unwrap();
        let names: Vec<String> = save_files(&nested)
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names.len(), 2, "{names:?}");
        assert!(names.contains(&"David.d2s".to_string()), "{names:?}");
        assert!(names.contains(&"ModernSharedStashSoftCoreV2.d2i".to_string()), "{names:?}");
        assert!(contains_saves(&nested));
    }

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("hlb-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn folder_tree_skips_tmp_and_symlinks() {
        let root = temp_dir("backup-tree");
        fs::create_dir_all(root.join("David")).unwrap();
        fs::write(root.join("David/David.d2s"), b"hero").unwrap();
        fs::write(root.join("David/David.key"), b"key").unwrap();
        fs::write(root.join("notes.hlb-tmp"), b"half").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("David/David.d2s"), root.join("David/link.d2s")).unwrap();
        let tree = folder_tree(&root);
        let rels: Vec<String> = tree.iter().map(|(r, _)| r.to_string_lossy().into_owned()).collect();
        assert_eq!(rels, ["David/David.d2s", "David/David.key"]);
    }

    #[test]
    fn folder_checksum_is_stable_and_content_sensitive() {
        let a = temp_dir("backup-hash-a");
        let b = temp_dir("backup-hash-b");
        for root in [&a, &b] {
            fs::create_dir_all(root.join("David")).unwrap();
            fs::write(root.join("David/David.d2s"), b"hero").unwrap();
            fs::write(root.join("Shared.d2i"), b"stash").unwrap();
        }
        let (ha, fa, ba) = folder_checksum(&folder_tree(&a)).unwrap();
        let (hb, _, _) = folder_checksum(&folder_tree(&b)).unwrap();
        assert_eq!(ha, hb);
        assert_eq!((fa, ba), (2, 9));
        // one byte changes the checksum; a rename does too (paths are part of the hash)
        fs::write(b.join("Shared.d2i"), b"stasX").unwrap();
        let (hb2, _, _) = folder_checksum(&folder_tree(&b)).unwrap();
        assert_ne!(ha, hb2);
    }

    #[test]
    fn prune_keeps_newest_snapshots_and_never_deletion_backups() {
        let d = temp_dir("backup-prune");
        for i in 0..32 {
            fs::create_dir_all(d.join(format!("2026-01-01_00-00-{:02}_000", i))).unwrap();
        }
        fs::create_dir_all(d.join("2026-01-01_00-00-99_000_deleted_Hero")).unwrap();
        let mut entries: Vec<BackupManifestEntry> = (0..32)
            .map(|i| BackupManifestEntry {
                dir: format!("2026-01-01_00-00-{:02}_000", i),
                kind: "save".into(),
                checksum: format!("{:016x}", i),
                files: 1,
                bytes: 1,
            })
            .collect();
        prune_snapshots(&d, &mut entries);
        assert_eq!(entries.len(), BACKUP_SNAPSHOTS);
        assert!(!d.join("2026-01-01_00-00-00_000").exists());
        assert!(d.join("2026-01-01_00-00-31_000").exists());
        assert!(d.join("2026-01-01_00-00-99_000_deleted_Hero").exists());
        // manifest round-trips through disk and the dedupe baseline is the newest surviving entry
        write_manifest(&d, &entries).unwrap();
        let back = read_manifest(&d);
        assert_eq!(back.len(), BACKUP_SNAPSHOTS);
        assert_eq!(dedupe_baseline(&d, &back).as_deref(), Some("000000000000001f"));
    }

    #[test]
    fn old_vaults_are_copied_into_the_save_folder_once() {
        let d = temp_dir("migrate");
        let (old, new) = (d.join("appdata/vaults"), d.join("saves").join(VAULT_DIR));
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(old.join("MainVault.hlb.json"), "{}").unwrap();
        fs::write(old.join("Old.hvault.json"), "{}").unwrap();
        fs::write(old.join("notes.txt"), "x").unwrap();
        migrate_vaults(&old, &new);
        assert!(new.join("MainVault.hlb.json").is_file());
        assert!(new.join("Old.hvault.json").is_file());
        assert!(!new.join("notes.txt").exists());
        assert!(old.join(MOVED_NOTE).is_file());
        assert!(old.join("MainVault.hlb.json").is_file(), "originals are kept");
        // a vault deleted in the new folder is not copied back on the next start
        fs::remove_file(new.join("MainVault.hlb.json")).unwrap();
        migrate_vaults(&old, &new);
        assert!(!new.join("MainVault.hlb.json").exists());
        // an existing vault with the same name is never overwritten
        let d2 = temp_dir("migrate2");
        let (o2, n2) = (d2.join("old"), d2.join(VAULT_DIR));
        fs::create_dir_all(&o2).unwrap();
        fs::create_dir_all(&n2).unwrap();
        fs::write(o2.join("A.hlb.json"), "old").unwrap();
        fs::write(n2.join("A.hlb.json"), "new").unwrap();
        migrate_vaults(&o2, &n2);
        assert_eq!(fs::read_to_string(n2.join("A.hlb.json")).unwrap(), "new");
    }

    #[test]
    fn atomic_write_replaces_file_and_leaves_no_temp() {
        let d = temp_dir("atomic");
        let f = d.join("Hero.d2s");
        fs::write(&f, b"old").unwrap();
        atomic_write(&f, b"new bytes").unwrap();
        assert_eq!(fs::read(&f).unwrap(), b"new bytes");
        assert!(children(&d)
            .iter()
            .all(|p| !p.to_string_lossy().ends_with(".hlb-tmp")));
    }

    #[test]
    fn write_refuses_non_saves_and_missing_files() {
        let d = temp_dir("refuse");
        assert!(write_file_atomic(d.join("x.txt").to_string_lossy().into(), vec![1]).is_err());
        assert!(
            write_file_atomic(d.join("Missing.d2s").to_string_lossy().into(), vec![1]).is_err()
        );
        assert!(read_file(d.join("x.txt").to_string_lossy().into()).is_err());
    }

    #[test]
    fn deletes_only_that_characters_files_after_backing_them_up() {
        let d = temp_dir("delete");
        for f in [
            "Hero.d2s",
            "Hero.key",
            "Hero.ctl",
            "Hero.map",
            "Hero.ma0",
            "Hero.txt",
            "Heroic.d2s",
            "Other.d2s",
            "SharedStashSoftCoreV2.d2i",
        ] {
            fs::write(d.join(f), f.as_bytes()).unwrap();
        }
        let backup = d.join("bk");
        let gone = delete_character_files(&d.join("Hero.d2s"), &backup).unwrap();
        assert_eq!(gone.len(), 5);
        for f in ["Hero.d2s", "Hero.key", "Hero.ctl", "Hero.map", "Hero.ma0"] {
            assert!(!d.join(f).exists(), "{} should be gone", f);
            assert_eq!(fs::read(backup.join(f)).unwrap(), f.as_bytes());
        }
        for f in [
            "Hero.txt",
            "Heroic.d2s",
            "Other.d2s",
            "SharedStashSoftCoreV2.d2i",
        ] {
            assert!(d.join(f).exists(), "{} must stay", f);
        }
        assert!(delete_character_files(&d.join("SharedStashSoftCoreV2.d2i"), &backup).is_err());
        assert!(delete_character_files(&d.join("Missing.d2s"), &backup).is_err());
    }

    #[test]
    fn finds_proton_prefix_saves() {
        let home = temp_dir("home");
        let saves = home.join(".local/share/Steam/steamapps/compatdata/2983472934/pfx/drive_c/users/steamuser/Saved Games/Diablo II Resurrected");
        fs::create_dir_all(&saves).unwrap();
        fs::write(saves.join("Warlock.d2s"), b"x").unwrap();
        std::env::set_var("HOME", &home);
        let found = detect_save_folders_inner();
        assert!(
            found
                .iter()
                .any(|p| p.ends_with("Diablo II Resurrected") && p.contains("compatdata")),
            "{:?}",
            found
        );
        let listed = list_saves(saves.to_string_lossy().into()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Warlock.d2s");
    }
}
