#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

typedef void (*HLBSyncCallback)(void *context, const char *result);

static NSInteger HLBSaveCount(NSURL *folder) {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSArray<NSURL *> *entries = [fm contentsOfDirectoryAtURL:folder includingPropertiesForKeys:@[NSURLIsDirectoryKey] options:NSDirectoryEnumerationSkipsHiddenFiles error:nil];
  NSInteger count = 0;
  for (NSURL *entry in entries) {
    NSNumber *isDirectory = nil;
    [entry getResourceValue:&isDirectory forKey:NSURLIsDirectoryKey error:nil];
    if (isDirectory.boolValue) {
      for (NSURL *child in [fm contentsOfDirectoryAtURL:entry includingPropertiesForKeys:nil options:NSDirectoryEnumerationSkipsHiddenFiles error:nil]) {
        NSString *ext = child.pathExtension.lowercaseString;
        if ([ext isEqualToString:@"d2s"] || [ext isEqualToString:@"d2i"]) count++;
      }
    } else {
      NSString *ext = entry.pathExtension.lowercaseString;
      if ([ext isEqualToString:@"d2s"] || [ext isEqualToString:@"d2i"]) count++;
    }
  }
  return count;
}

static NSURL *HLBArtRoot(NSURL *selected) {
  NSFileManager *fm = NSFileManager.defaultManager;
  for (NSString *suffix in @[@"", @"hd", @"data/hd", @"data/data/hd"]) {
    NSURL *root = suffix.length ? [selected URLByAppendingPathComponent:suffix isDirectory:YES] : selected;
    BOOL isDirectory = NO;
    NSURL *items = [root URLByAppendingPathComponent:@"global/ui/items" isDirectory:YES];
    if ([fm fileExistsAtPath:items.path isDirectory:&isDirectory] && isDirectory &&
        [fm fileExistsAtPath:[root URLByAppendingPathComponent:@"items/items.json"].path]) return root;
  }
  return nil;
}

static NSInteger HLBArtCount(NSURL *folder) {
  NSInteger count = 0;
  NSDirectoryEnumerator<NSURL *> *files = [NSFileManager.defaultManager enumeratorAtURL:folder includingPropertiesForKeys:nil options:NSDirectoryEnumerationSkipsHiddenFiles errorHandler:nil];
  for (NSURL *file in files) if ([file.pathExtension.lowercaseString isEqualToString:@"sprite"]) count++;
  return count;
}

static NSString *HLBImportArt(NSURL *selected, NSURL *workspace) {
  BOOL scoped = [selected startAccessingSecurityScopedResource];
  NSFileManager *fm = NSFileManager.defaultManager;
  NSURL *parent = [workspace URLByDeletingLastPathComponent];
  // A terminated import can leave a hidden partial copy. A new picker cannot
  // start while another one is active in this process, so these are stale.
  for (NSURL *entry in [fm contentsOfDirectoryAtURL:parent includingPropertiesForKeys:nil options:0 error:nil]) {
    if ([entry.lastPathComponent hasPrefix:@".resources-import-"]) [fm removeItemAtURL:entry error:nil];
  }
  NSURL *staged = [parent URLByAppendingPathComponent:[@".resources-import-" stringByAppendingString:[NSUUID UUID].UUIDString] isDirectory:YES];
  __block NSError *copyError = nil;
  __block BOOL validSource = YES;
  NSError *coordinateError = nil;
  NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
  [coordinator coordinateReadingItemAtURL:selected options:0 error:&coordinateError byAccessor:^(NSURL *readURL) {
    NSURL *root = HLBArtRoot(readURL);
    if (!root) { validSource = NO; return; }
    NSURL *targetItems = [staged URLByAppendingPathComponent:@"hd/global/ui/items" isDirectory:YES];
    NSURL *targetJson = [staged URLByAppendingPathComponent:@"hd/items" isDirectory:YES];
    if (![fm createDirectoryAtURL:[targetItems URLByDeletingLastPathComponent] withIntermediateDirectories:YES attributes:nil error:&copyError] ||
        ![fm createDirectoryAtURL:targetJson withIntermediateDirectories:YES attributes:nil error:&copyError]) return;
    if (![fm copyItemAtURL:[root URLByAppendingPathComponent:@"global/ui/items" isDirectory:YES] toURL:targetItems error:&copyError]) return;
    for (NSString *name in @[@"items.json", @"uniques.json", @"sets.json"]) {
      NSURL *source = [[root URLByAppendingPathComponent:@"items" isDirectory:YES] URLByAppendingPathComponent:name];
      if ([fm fileExistsAtPath:source.path]) {
        if (![fm copyItemAtURL:source toURL:[targetJson URLByAppendingPathComponent:name] error:&copyError]) return;
      }
    }
  }];
  if (scoped) [selected stopAccessingSecurityScopedResource];
  NSError *error = coordinateError ?: copyError;
  if (!validSource || error) {
    [fm removeItemAtURL:staged error:nil];
    return [@"error:" stringByAppendingString:error.localizedDescription ?: @"请选择包含 hd/global/ui/items 和 hd/items/items.json 的资源目录。"];
  }
  NSInteger count = HLBArtCount([staged URLByAppendingPathComponent:@"hd/global/ui/items" isDirectory:YES]);
  if (!count) {
    [fm removeItemAtURL:staged error:nil];
    return @"error:所选目录没有 .sprite 图片资源。";
  }

  NSURL *support = [fm URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
  NSURL *backup = [[support URLByAppendingPathComponent:@"import-backups" isDirectory:YES]
    URLByAppendingPathComponent:[NSString stringWithFormat:@"%@-%@", @((long long)[NSDate date].timeIntervalSince1970), [NSUUID UUID].UUIDString] isDirectory:YES];
  if (![fm createDirectoryAtURL:backup withIntermediateDirectories:YES attributes:nil error:&error]) {
    [fm removeItemAtURL:staged error:nil];
    return [@"error:" stringByAppendingString:error.localizedDescription];
  }
  BOOL hadWorkspace = [fm fileExistsAtPath:workspace.path];
  NSURL *old = [backup URLByAppendingPathComponent:@"resources" isDirectory:YES];
  if (hadWorkspace && ![fm moveItemAtURL:workspace toURL:old error:&error]) {
    [fm removeItemAtURL:staged error:nil];
    return [@"error:" stringByAppendingString:error.localizedDescription];
  }
  if (![fm moveItemAtURL:staged toURL:workspace error:&error]) {
    if (hadWorkspace) [fm moveItemAtURL:old toURL:workspace error:nil];
    [fm removeItemAtURL:staged error:nil];
    return [@"error:" stringByAppendingString:error.localizedDescription];
  }
  return [NSString stringWithFormat:@"ok:%ld", (long)count];
}

@interface HLBSyncPicker : NSObject <UIDocumentPickerDelegate>
@property(nonatomic, strong) NSURL *workspace;
@property(nonatomic, assign) BOOL importing;
@property(nonatomic, assign) NSInteger mode;
@property(nonatomic, assign) HLBSyncCallback callback;
@property(nonatomic, assign) void *context;
- (void)finish:(NSString *)result;
@end

static HLBSyncPicker *activePicker;

@implementation HLBSyncPicker

- (void)finish:(NSString *)result {
  self.callback(self.context, result.UTF8String);
  activePicker = nil;
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
  [self finish:@"cancel"];
}

- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
  NSURL *selected = urls.firstObject;
  if (!selected) { [self finish:@"cancel"]; return; }
  if (self.mode == 2) {
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      NSString *result = HLBImportArt(selected, self.workspace);
      dispatch_async(dispatch_get_main_queue(), ^{ [self finish:result]; });
    });
    return;
  }
  if (!self.importing) {
    [self finish:@"ok:export"];
    return;
  }

  // A picked folder belongs to another app or a File Provider. Keep its security
  // scope open for the whole coordinated read and copy into our own Documents.
  BOOL scoped = [selected startAccessingSecurityScopedResource];
  NSFileManager *fm = NSFileManager.defaultManager;
  NSURL *parent = [self.workspace URLByDeletingLastPathComponent];
  NSURL *staged = [parent URLByAppendingPathComponent:[@".save-import-" stringByAppendingString:[NSUUID UUID].UUIDString] isDirectory:YES];
  __block NSError *copyError = nil;
  NSError *coordinateError = nil;
  NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
  [coordinator coordinateReadingItemAtURL:selected options:0 error:&coordinateError byAccessor:^(NSURL *readURL) {
    [fm copyItemAtURL:readURL toURL:staged error:&copyError];
  }];
  if (scoped) [selected stopAccessingSecurityScopedResource];
  NSError *error = coordinateError ?: copyError;
  if (error) {
    [fm removeItemAtURL:staged error:nil];
    [self finish:[@"error:" stringByAppendingString:error.localizedDescription]];
    return;
  }
  NSInteger count = HLBSaveCount(staged);
  if (!count) {
    [fm removeItemAtURL:staged error:nil];
    [self finish:@"error:所选文件夹中没有 .d2s 或 .d2i 存档，请选择 D2R Mobile 的 save 文件夹。"];
    return;
  }

  // Replace only after the entire source folder is safely staged. Preserve the
  // previous workspace in Application Support before switching over.
  NSURL *support = [fm URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
  NSURL *backup = [[support URLByAppendingPathComponent:@"import-backups" isDirectory:YES]
    URLByAppendingPathComponent:[NSString stringWithFormat:@"%@-%@", @((long long)[NSDate date].timeIntervalSince1970), [NSUUID UUID].UUIDString] isDirectory:YES];
  if (![fm createDirectoryAtURL:backup withIntermediateDirectories:YES attributes:nil error:&error]) {
    [fm removeItemAtURL:staged error:nil];
    [self finish:[@"error:" stringByAppendingString:error.localizedDescription]];
    return;
  }
  BOOL hadWorkspace = [fm fileExistsAtPath:self.workspace.path];
  NSURL *old = [backup URLByAppendingPathComponent:@"save" isDirectory:YES];
  if (hadWorkspace && ![fm moveItemAtURL:self.workspace toURL:old error:&error]) {
    [fm removeItemAtURL:staged error:nil];
    [self finish:[@"error:" stringByAppendingString:error.localizedDescription]];
    return;
  }
  if (![fm moveItemAtURL:staged toURL:self.workspace error:&error]) {
    if (hadWorkspace) [fm moveItemAtURL:old toURL:self.workspace error:nil];
    [fm removeItemAtURL:staged error:nil];
    [self finish:[@"error:" stringByAppendingString:error.localizedDescription]];
    return;
  }
  [self finish:[NSString stringWithFormat:@"ok:%ld", (long)count]];
}

@end

extern "C" void hlb_sync_save_folder(int mode, const char *workspacePath, HLBSyncCallback callback, void *context) {
  NSString *path = [NSString stringWithUTF8String:workspacePath];
  dispatch_async(dispatch_get_main_queue(), ^{
    if (activePicker) { callback(context, "error:已有文件选择窗口打开"); return; }
    NSURL *workspace = [NSURL fileURLWithPath:path isDirectory:YES];
    if (mode == 1 && HLBSaveCount(workspace) == 0) {
      callback(context, "error:当前没有可导出的存档，请先导入 save 文件夹。");
      return;
    }
    HLBSyncPicker *pickerDelegate = [HLBSyncPicker new];
    pickerDelegate.workspace = workspace;
    pickerDelegate.importing = mode == 0;
    pickerDelegate.mode = mode;
    pickerDelegate.callback = callback;
    pickerDelegate.context = context;
    activePicker = pickerDelegate;
    UIDocumentPickerViewController *picker = mode != 1
      ? [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:@[UTTypeFolder] asCopy:NO]
      : [[UIDocumentPickerViewController alloc] initForExportingURLs:@[workspace] asCopy:YES];
    picker.delegate = pickerDelegate;
    picker.modalPresentationStyle = UIModalPresentationFullScreen;
    UIViewController *presenter = nil;
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if (![scene isKindOfClass:UIWindowScene.class]) continue;
      for (UIWindow *window in ((UIWindowScene *)scene).windows) {
        if (window.isKeyWindow) { presenter = window.rootViewController; break; }
      }
      if (presenter) break;
    }
    if (!presenter) {
      activePicker = nil;
      callback(context, "error:无法打开文件选择窗口");
      return;
    }
    while (presenter.presentedViewController) presenter = presenter.presentedViewController;
    [presenter presentViewController:picker animated:YES completion:nil];
  });
}
