import { useStore } from '../../src/ui/context';
import { ItemBox } from './items';
import { TRAY_CELL, TRAY_COLS, packTray, trayDoc, trayEntries } from './model';

export function TrayHandle({ onOpen }: { onOpen: () => void }) {
  const store = useStore();
  const count = trayEntries(store).length;
  return (
    <button className="m-trayhandle" data-trayhandle onClick={onOpen} aria-label={`装备托盘（${count} 件）`}>
      托盘
      <span className="m-traycnt">{count}</span>
    </button>
  );
}

/** Slide-out tray drawer (SPEC §7): a vault-format loading area, always written with its items. */
export function TrayDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const tray = trayDoc(store);
  const entries = tray?.vault.entries ?? [];
  const positions = packTray(entries);
  const rows = entries.reduce((m, e) => Math.max(m, (positions.get(e.uid)?.y ?? 0) + (e.item.def?.h ?? 1)), 0);
  return (
    <>
      <div className={`m-scrim${open ? ' on' : ''}`} onClick={onClose} />
      <aside className={`m-tray${open ? ' on' : ''}`} aria-hidden={!open}>
        <div className="m-trayhead">
          <span className="m-traytitle">装备托盘</span>
          <button className="m-trayclose" onClick={onClose} aria-label="关闭托盘">
            ✕
          </button>
        </div>
        <div className="m-traysub">
          临时中转区 · <b>实时落盘</b>，放进来就可以直接退应用。
          <br />
          双击托盘物品 → 放回当前屏幕的网格区（背包 / 仓库 / 方块）。
        </div>
        <div className="m-traybody">
          {entries.length === 0 ? (
            <div className="m-trayempty">
              托盘是空的。
              <br />
              在任意网格里<b>双击</b>一件物品，或把物品<b>拖</b>到右侧把手上，就能放进来。
            </div>
          ) : (
            tray && (
              <div
                className="m-gridwrap"
                style={{ width: TRAY_COLS * TRAY_CELL, height: Math.max(rows, 1) * TRAY_CELL, margin: '0 auto' }}
              >
                <div className="m-gridbg" style={{ ['--c' as string]: `${TRAY_CELL}px` }} />
                {entries.map((e) => {
                  const p = positions.get(e.uid);
                  if (!p) return null;
                  const w = e.item.def?.w ?? 1;
                  const h = e.item.def?.h ?? 1;
                  return (
                    <ItemBox
                      key={e.uid}
                      item={e.item}
                      loc={{ docId: tray.id, kind: 'vault' }}
                      width={w * TRAY_CELL - 2}
                      height={h * TRAY_CELL - 2}
                      cell={TRAY_CELL}
                      style={{ left: p.x * TRAY_CELL + 1, top: p.y * TRAY_CELL + 1 }}
                    />
                  );
                })}
              </div>
            )
          )}
        </div>
        <div className="m-trayfoot">托盘里的物品不属于任何角色，游戏里读不到；要用之前先放回背包或仓库。</div>
      </aside>
    </>
  );
}
