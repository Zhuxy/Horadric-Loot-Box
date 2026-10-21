import { useMemo, useState } from 'react';
import { useStore } from '../../src/ui/context';
import type { GoldRef } from '../../src/state/store';
import { Sheet } from './parts';
import { fmt, goldAccountLabel, transferTargets } from './model';

export function GoldRow({
  label,
  amount,
  cap,
  onClick,
}: {
  label: string;
  amount: number;
  cap?: number;
  onClick: () => void;
}) {
  return (
    <button className="m-goldrow" onClick={onClick}>
      <span className="m-goldicon">🪙</span>
      <span className="m-goldlabel">
        {label}
        {cap !== undefined && <span className="m-goldcap"> · 上限 {fmt(cap)}</span>}
      </span>
      <span className="m-goldamt">{fmt(amount)}</span>
      <span className="m-goldact">存 / 取</span>
    </button>
  );
}

/** Gold transfer sheet (SPEC §9): source fixed, pick a destination, amount clamps to both limits. */
export function GoldSheet({ from, charId, onClose, afterChange }: { from: GoldRef; charId?: string; onClose: () => void; afterChange: () => void }) {
  const store = useStore();
  const targets = useMemo(() => transferTargets(store, from, charId), [store, from, charId]);
  const [destKey, setDestKey] = useState(() => (targets[0] ? JSON.stringify(targets[0]) : ''));
  const [amount, setAmount] = useState('');
  const dest = targets.find((t) => JSON.stringify(t) === destKey);
  const balance = store.goldOf(from);
  const destBalance = dest ? store.goldOf(dest) : 0;
  const destCap = dest ? store.goldCap(dest) : 0;
  const room = dest ? Math.max(0, destCap - destBalance) : 0;
  const max = Math.min(balance, room);

  const confirm = () => {
    if (!dest) return;
    const wanted = Math.floor(Number(amount) || 0);
    const n = Math.max(0, Math.min(wanted, balance, room));
    if (n <= 0) {
      store.toast('error', '没有可转移的金额（检查余额与上限）');
      return;
    }
    const moved = store.transferGold(from, dest, n);
    if (moved > 0) {
      afterChange();
      onClose();
    }
  };

  return (
    <Sheet open onClose={onClose}>
      <h3>🪙 金币转移</h3>
      <div className="m-sheet-base">
        从「{goldAccountLabel(store, from)}」转出 · 余额 <b>{fmt(balance)}</b>
      </div>
      {targets.length === 0 ? (
        <div className="m-empty">没有同版本 / 同 HC·SC 的可转移账户。</div>
      ) : (
        <>
          <div className="m-frow">
            <div className="m-fl">转入</div>
            <div className="m-destchips">
              {targets.map((t) => {
                const key = JSON.stringify(t);
                return (
                  <button key={key} className={key === destKey ? 'on' : ''} onClick={() => setDestKey(key)}>
                    {goldAccountLabel(store, t)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="m-gamount">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
              type="number"
              inputMode="numeric"
              placeholder="输入金额"
            />
            <button onClick={() => setAmount(String(max))}>最大</button>
          </div>
          {dest && (
            <div className="m-gbal">
              目标「{goldAccountLabel(store, dest)}」当前 <b>{fmt(destBalance)}</b>
              {destCap < Number.MAX_SAFE_INTEGER ? (
                <>
                  {' '}· 上限 <b>{fmt(destCap)}</b> · 还可存 <b>{fmt(room)}</b>
                </>
              ) : (
                ' · 无上限'
              )}
            </div>
          )}
          <div className="m-sheet-btns">
            <button className="m-primary m-wide" onClick={confirm}>
              确认转移
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
