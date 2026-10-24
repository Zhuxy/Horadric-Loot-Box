import { StashTabType, type D2Character, type D2SharedStash } from '../../src/core';
import { docLabel, type GoldRef } from '../../src/state/store';
import { useStore } from '../../src/ui/context';
import { Grid } from './items';
import { GoldRow } from './gold';
import { StackBoard } from './stackables';
import { characterDocs, isEditableTab, stashDocs, tabLabel } from './model';

/** Stash tab: current character chips, personal/shared segments, grid sized to the save (SPEC §10), one shared gold pool. */
export function StashScreen({
  charId,
  onChar,
  segment,
  onSegment,
  sharedId,
  onShared,
  sharedTab,
  onSharedTab,
  onGold,
}: {
  charId?: string;
  onChar: (id: string) => void;
  segment: 'personal' | 'shared';
  onSegment: (s: 'personal' | 'shared') => void;
  sharedId?: string;
  onShared: (id: string) => void;
  sharedTab: number;
  onSharedTab: (tab: number) => void;
  onGold: (ref: GoldRef) => void;
}) {
  const store = useStore();
  const chars = characterDocs(store);
  const stashes = stashDocs(store);
  const current = charId ? (store.docs.get(charId)?.doc as D2Character | undefined) : undefined;
  const stash = sharedId ? (store.docs.get(sharedId)?.doc as D2SharedStash | undefined) : stashes[0]?.stash;
  const stashDocId = sharedId ?? stashes[0]?.id;
  const tabs = stash
    ? stash.tabs.map((t, i) => ({ t, i })).filter(({ t }) => t.type === StashTabType.Normal || t.type === StashTabType.Advanced)
    : [];
  const activeTab = tabs.some(({ i }) => i === sharedTab) ? sharedTab : tabs[0]?.i ?? 0;
  const sharedRef = stashDocId ? store.sharedGoldRef(stashDocId, stash?.modern ? undefined : activeTab) : undefined;

  return (
    <div className="m-stashwrap">
      <div className="m-charchips">
        {chars.map(({ id, ch }) => (
          <button key={id} className={id === charId ? 'on' : ''} onClick={() => onChar(id)}>
            {ch.name} · {ch.level} 级 {ch.className}
          </button>
        ))}
      </div>
      <div className="m-seg">
        <button className={segment === 'personal' ? 'on' : ''} onClick={() => onSegment('personal')}>
          个人仓库
        </button>
        <button className={segment === 'shared' ? 'on' : ''} onClick={() => onSegment('shared')}>
          共享仓库
        </button>
      </div>

      {segment === 'personal' ? (
        current ? (
          <>
            <GoldRow
              label={`${current.name} 的仓库金币`}
              amount={store.goldOf({ docId: charId!, kind: 'stash' })}
              cap={store.goldCap({ docId: charId!, kind: 'stash' })}
              onClick={() => onGold({ docId: charId!, kind: 'stash' })}
            />
            <div className="m-spacer" />
            <Grid docId={charId!} doc={current} area="stash" maxHeight={300} />
            <div className="m-spacer" />
            <div className="m-hintline">个人仓库跟角色走 · 金币点上方金币行取出</div>
          </>
        ) : (
          <div className="m-empty">还没有角色存档。</div>
        )
      ) : stash && stashDocId ? (
        <>
          {stashes.length > 1 && (
            <div className="m-docchips">
              {stashes.map(({ id, stash: s }) => (
                <button key={id} className={id === stashDocId ? 'on' : ''} onClick={() => onShared(id)}>
                  {docLabel(s, id)}
                </button>
              ))}
            </div>
          )}
          <div className="m-tabchips">
            {tabs.map(({ t, i }) => (
              <button key={i} className={i === activeTab ? 'on' : ''} onClick={() => onSharedTab(i)}>
                {t.type === StashTabType.Advanced ? '材料' : tabLabel(i)}
              </button>
            ))}
          </div>
          {sharedRef && (
            <GoldRow
              label={store.goldPooled(stashDocId) ? '共享金币（全部页签共用一池）' : `共享金币 · ${tabLabel(activeTab)}`}
              amount={store.goldOf(sharedRef)}
              cap={store.goldCap(sharedRef)}
              onClick={() => onGold(sharedRef)}
            />
          )}
          <div className="m-spacer" />
          {stash.tabs[activeTab]?.type === StashTabType.Advanced ? (
            <StackBoard docId={stashDocId} stash={stash} tab={activeTab} />
          ) : isEditableTab(stash, activeTab) ? (
            <Grid docId={stashDocId} doc={stash} area="shared" tab={activeTab} maxHeight={300} />
          ) : (
            <div className="m-empty">这一页不是物品页。</div>
          )}
          <div className="m-spacer" />
          <div className="m-hintline">{docLabel(stash, stashDocId)} · 共享仓库对全部角色可见</div>
        </>
      ) : (
        <div className="m-empty">没有共享仓库存档。</div>
      )}
    </div>
  );
}
