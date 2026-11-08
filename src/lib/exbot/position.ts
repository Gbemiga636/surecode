/** Position bookkeeping, ported from exbot/manage.py (the trend strategy uses no profit targets). */
import { COSTS } from "./config";

export type Exit = [time: string, price: number, qty: number, reason: string];

export type Position = {
  symbol: string;
  side: 1 | -1;
  entry: number;
  stop: number;
  stop0: number;
  qty: number;
  qtyOpen: number;
  entryTime: string;
  barsHeld: number;
  realized: number;
  fees: number;
  exits: Exit[];
  orderIds: { stop?: string };
  tradeId?: number;
};

export const riskUsd = (p: Position) => p.qty * Math.abs(p.entry - p.stop0);
export const rMultiple = (p: Position) => (riskUsd(p) > 0 ? p.realized / riskUsd(p) : 0);
export const isClosed = (p: Position) => p.qtyOpen <= 1e-12;

export function fill(p: Position, price: number, qty: number, feeRate: number, time: string, reason: string): number {
  qty = Math.min(qty, p.qtyOpen);
  if (qty <= 0) return 0;
  const fee = price * qty * feeRate;
  const pnl = p.side * (price - p.entry) * qty - fee;
  p.qtyOpen -= qty;
  p.realized += pnl;
  p.fees += fee;
  p.exits.push([time, price, qty, reason]);
  return pnl;
}

/** Stop check for one bar. A gap through the stop fills at the open. */
export function simulateStop(p: Position, o: number, h: number, l: number, time: string): boolean {
  const s = p.side;
  const hit = s === 1 ? l <= p.stop : h >= p.stop;
  if (!hit) return false;
  const gap = s === 1 ? o <= p.stop : o >= p.stop;
  const px = (gap ? o : p.stop) * (1 - s * COSTS.slippage);
  fill(p, px, p.qtyOpen, COSTS.takerFee, time, "stop");
  return true;
}
