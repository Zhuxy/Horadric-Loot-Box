import { useState } from 'react';
import { Sheet } from './parts';
import { CATEGORY_FILTERS, QUALITY_FILTERS, emptyFilter, type VaultFilter } from './model';

/** Vault filter sheet (SPEC §5.3, first phase: text, quality, type, level range, sockets, ethereal). */
export function FilterSheet({
  filter,
  onApply,
  onClose,
}: {
  filter: VaultFilter;
  onApply: (f: VaultFilter) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(filter);
  return (
    <Sheet open onClose={onClose}>
      <h3>宝库筛选（参考 GoMule）</h3>
      <div className="m-frow">
        <div className="m-fl">品质</div>
        <div className="m-destchips">
          {QUALITY_FILTERS.map(([id, label]) => (
            <button key={id} className={draft.quality === id ? 'on' : ''} onClick={() => setDraft({ ...draft, quality: id })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="m-frow">
        <div className="m-fl">类型</div>
        <div className="m-destchips">
          {CATEGORY_FILTERS.map(([id, label]) => (
            <button key={id} className={draft.category === id ? 'on' : ''} onClick={() => setDraft({ ...draft, category: id })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="m-frow">
        <div className="m-fl">需要等级区间</div>
        <div className="m-rng">
          <input value={draft.lvlMin} onChange={(e) => setDraft({ ...draft, lvlMin: e.target.value.replace(/[^\d]/g, '') })} type="number" inputMode="numeric" placeholder="最低" />
          <span>—</span>
          <input value={draft.lvlMax} onChange={(e) => setDraft({ ...draft, lvlMax: e.target.value.replace(/[^\d]/g, '') })} type="number" inputMode="numeric" placeholder="最高" />
        </div>
      </div>
      <div className="m-frow">
        <div className="m-fl">其他条件</div>
        <div className="m-togrow">
          <label>
            <input type="checkbox" checked={draft.eth} onChange={(e) => setDraft({ ...draft, eth: e.target.checked })} /> 无形
          </label>
          <label>
            <input type="checkbox" checked={draft.sock} onChange={(e) => setDraft({ ...draft, sock: e.target.checked })} /> 带凹槽
          </label>
        </div>
      </div>
      <div className="m-frow m-faint m-small">二期：属性条件构建器（如「快速施法 ≥ 20%」）后续加入。</div>
      <div className="m-sheet-btns">
        <button
          onClick={() => {
            onApply(emptyFilter(draft.text));
            onClose();
          }}
        >
          清空条件
        </button>
        <button
          className="m-primary"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          应用
        </button>
      </div>
    </Sheet>
  );
}
