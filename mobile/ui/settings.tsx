import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../../src/platform/tauri';
import { useStore } from '../../src/ui/context';
import { flushSave } from './mobileStore';
import { fmt } from './model';

function SettingsBlock({ icon, title, note, tag, children }: { icon: string; title: string; note: string; tag?: { text: string; live?: boolean }; children?: React.ReactNode }) {
  return (
    <section className="m-setblock">
      <div className="m-setrow">
        <span className="m-seticon">{icon}</span>
        <div className="m-setmain">
          <div className="m-st">{title}</div>
          <div className="m-sd">{note}</div>
        </div>
        {tag && <span className={`m-tag${tag.live ? ' live' : ''}`}>{tag.text}</span>}
      </div>
      {children && <div className="m-setbody">{children}</div>}
    </section>
  );
}

/** Settings tab (SPEC §5.4): sync, artwork, backups and about. The tray and real-time saving have no switches. */
export function SettingsScreen({ afterChange }: { afterChange: () => void }) {
  const store = useStore();
  const [busy, setBusy] = useState<'import' | 'export' | 'reload' | 'art' | null>(null);
  const tauri = isTauri();
  const flushOrThrow = async () => {
    await flushSave(store);
    if (store.dirtyDocs.some((d) => d.doc)) throw new Error('还有修改没有写盘');
  };

  const importSaves = async () => {
    if (!tauri) return;
    setBusy('import');
    try {
      await flushOrThrow();
      if (store.files.length && !window.confirm('导入会替换本 App 当前的 save 文件夹（旧文件会先备份在 App 内），继续吗？')) return;
      // Snapshot the outgoing folder before the native sync replaces it; a backup failure
      // aborts the import rather than destroying the only copy.
      if (store.folder) await store.platform.backupFolder(store.folder, 'import');
      const count = await invoke<string | null>('ios_import_saves');
      if (count !== null) {
        await store.reload();
        store.toast('success', `已导入 ${count} 个存档。`);
      }
    } catch (error) {
      store.toast('error', `导入失败：${String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const exportSaves = async () => {
    if (!tauri) return;
    setBusy('export');
    try {
      await flushOrThrow();
      const result = await invoke<string | null>('ios_export_saves');
      if (result !== null) store.toast('success', '已将 save 文件夹导出到所选位置。');
    } catch (error) {
      store.toast('error', `导出失败：${String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const reload = async () => {
    setBusy('reload');
    try {
      await flushOrThrow();
      await store.reload();
      afterChange();
    } catch (error) {
      store.toast('error', `重新载入失败：${(error as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const importArt = async () => {
    if (!tauri) return;
    if (store.art && !window.confirm('导入会替换当前物品图片资源，旧资源会保留备份。继续吗？')) return;
    setBusy('art');
    try {
      const count = await invoke<string | null>('ios_import_art');
      if (count === null) return;
      const path = await invoke<string | null>('ios_art_folder');
      if (!path) throw new Error('导入后找不到资源目录');
      await store.loadArt(path);
      if (store.artStatus.state !== 'ready') throw new Error(store.artStatus.message);
      store.toast('success', `已导入 ${count} 张物品图片。`);
    } catch (error) {
      store.toast('error', `资源导入失败：${String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const artReady = store.artStatus.state === 'ready';

  return (
    <div className="m-scroll m-settings">
      <SettingsBlock
        icon="📥"
        title="存档同步（考进考出）"
        note={`把 D2R Mobile 的 save 文件夹考入 App，也可以把改好的 save 导出回文件 App。当前 ${store.files.length} 个存档。`}
        tag={tauri ? undefined : { text: '仅真机' }}
      >
        <div className="m-setstats">文件 › 我的 iPhone › Horadric Loot Box › save</div>
        <button className="m-btn m-btn-gold" disabled={!!busy || !tauri} onClick={importSaves}>
          {busy === 'import' ? '导入中…' : '从 D2R Mobile 导入 save'}
        </button>
        <button className="m-btn m-btn-ghost" disabled={!!busy || !tauri || !store.files.length} onClick={exportSaves}>
          {busy === 'export' ? '导出中…' : '导出 save 到指定位置'}
        </button>
        <button className="m-btn m-btn-ghost" disabled={!!busy} onClick={reload}>
          {busy === 'reload' ? '载入中…' : '重新载入'}
        </button>
      </SettingsBlock>

      <SettingsBlock
        icon="🎨"
        title="美术资源包"
        note={artReady ? `已加载 ${store.art?.sprites.size ?? 0} 张物品图片。` : '从自己购买的 D2R 解包物品图标后导入，无资源时显示字形图标。'}
        tag={{ text: artReady ? '已导入' : '未导入', live: artReady }}
      >
        <div className="m-setstats">文件 › 我的 iPhone › Horadric Loot Box › resources</div>
        <div className="m-sethint">选择解包后的资源目录（包含 hd/global/ui/items 和 hd/items/items.json），App 只拷贝物品图片和索引。</div>
        {store.artStatus.state === 'error' && <div className="m-sethint m-errtext">读取失败：{store.artStatus.message}</div>}
        <button className="m-btn m-btn-ghost" disabled={!!busy || !tauri} onClick={importArt}>
          {busy === 'art' ? '导入资源中…' : store.art ? '重新导入图片资源' : '导入 D2R 图片资源'}
        </button>
      </SettingsBlock>

      <SettingsBlock
        icon="🗂️"
        title="备份管理"
        note="每次写盘前自动备份，备份留在 App 内。"
        tag={store.lastBackup ? { text: '已备份', live: true } : { text: '自动' }}
      >
        <div className="m-setstats">{store.lastBackup ? `最近备份：${store.lastBackup}` : '本次启动还没有写盘。'}</div>
        {store.platform.revealBackups && store.lastBackup && (
          <button className="m-btn m-btn-ghost" onClick={() => void store.platform.revealBackups!().catch((e) => store.toast('error', String(e)))}>
            打开备份文件夹
          </button>
        )}
        {!store.platform.revealBackups && <div className="m-sethint">备份在文件 App 的 HLB Backups 文件夹里；应用内查看 / 恢复入口在后续版本补齐。</div>}
      </SettingsBlock>

      <SettingsBlock icon="ℹ️" title="关于" note="Horadric Loot Box 移动版 · 随身仓库管理" tag={{ text: `v${__APP_VERSION__}` }}>
        <div className="m-sethint">
          {fmt(store.docs.size)} 个文档 · {fmt(store.files.length)} 个存档
        </div>
        <div className="m-sethint">
          实时保存与装备托盘是常开基础行为（关掉功能链就不完整），因此设置里没有开关。全局撤销在顶栏 ↶。
        </div>
      </SettingsBlock>

      <div className="m-hintline m-small">存档修改前会先备份；请先在游戏里保存并退出，再在 App 里改。</div>
      <div style={{ height: 16 }} />
    </div>
  );
}
