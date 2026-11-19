import { useEffect, useRef, type TouchEvent } from 'react';
import { ArrowLeft, Bike, Check, ChefHat, Undo2, Utensils } from 'lucide-react';
import type { Order } from '../lib/types';
import { cn, durationText, fen } from '../lib/utils';

const STATUS_TEXT: Record<string, string> = {
  UNPAID: '待支付',
  PENDING: '待接单',
  PREPARING: '制作中',
  READY: '待取餐',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

function clockOf(input?: string | null): string {
  if (!input) return '-';
  const date = new Date(input);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function placeText(order: Order): string {
  if (order.type === 'DELIVERY') return '外卖';
  if (order.type === 'TAKEAWAY') return '打包';
  return order.tableName || '堂食';
}

function statusClass(status: string): string {
  if (status === 'PENDING') return 'bg-brand/10 text-brand';
  if (status === 'PREPARING') return 'bg-amber-50 text-amber-700';
  if (status === 'READY') return 'bg-sky-50 text-sky-700';
  if (status === 'COMPLETED') return 'bg-emerald-50 text-emerald-700';
  return 'bg-black/5 text-ink-900/45';
}

/** 单张订单的整屏内容 */
function OrderPane({ order }: { order: Order }) {
  const isDelivery = order.type === 'DELIVERY';
  const isTakeaway = order.type === 'TAKEAWAY';

  return (
    <div className="space-y-4 px-4 pb-6 pt-3">
      <section
        className="relative overflow-hidden rounded-2xl p-4 text-white"
        style={{
          backgroundImage: isTakeaway
            ? 'linear-gradient(140deg, #2563EB, #1E40AF)'
            : 'linear-gradient(140deg, var(--brand), var(--brand-dark))',
        }}
      >
        <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/15" />
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[14px] text-white/75">{isDelivery ? '外卖配送' : isTakeaway ? '打包自取' : '堂食桌号'}</p>
            <p className="num mt-1 text-[80px] font-bold leading-none">{placeText(order)}</p>
          </div>
          {order.pickupNo && !isDelivery && (
            <div className="text-right">
              <p className="text-[13px] text-white/65">取餐号</p>
              <p className="num text-[34px] font-bold leading-none">#{order.pickupNo}</p>
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[14px] text-white/80">
          <span>{clockOf(order.createdAt)} 下单</span>
          <span>·</span>
          <span>已等 {durationText(order.createdAt)}</span>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[20px] font-semibold">商品清单</p>
          <p className="text-[16px] text-ink-900/45">共 {order.itemCount} 件</p>
        </div>
        {order.items.map((item) => (
          <div key={item.id} className="flex items-start gap-3 border-b border-black/[0.05] py-4 last:border-0">
            <span className="num mt-0.5 w-10 shrink-0 text-[21px] font-semibold text-ink-900/75">{item.quantity}×</span>
            <div className="min-w-0 flex-1">
              <p className="text-[24px] font-medium leading-snug">{item.productName}</p>
              {item.specText && <p className="mt-1 text-[17px] leading-relaxed text-ink-900/45">{item.specText}</p>}
              {item.remark && <p className="mt-1 text-[17px] text-brand">备注：{item.remark}</p>}
            </div>
            <span className="num shrink-0 text-[21px] text-ink-900/75">¥{fen(item.amount)}</span>
          </div>
        ))}
      </section>

      {order.remark && (
        <section className="rounded-2xl bg-amber-50 p-4 text-[21px] leading-relaxed text-amber-800">
          <span className="font-semibold">顾客备注：</span>
          {order.remark}
        </section>
      )}

      <section className="mt-3 rounded-2xl bg-white p-4 text-[15px]">
        <div className="flex justify-between py-1.5 text-ink-900/60">
          <span>商品金额</span>
          <span className="num">¥{fen(order.itemAmount)}</span>
        </div>
        {order.discountAmount > 0 && (
          <div className="flex justify-between py-1.5 text-brand">
            <span>满减优惠</span>
            <span className="num">-¥{fen(order.discountAmount)}</span>
          </div>
        )}
        {order.packingFee > 0 && (
          <div className="flex justify-between py-1.5 text-ink-900/60">
            <span>打包费</span>
            <span className="num">¥{fen(order.packingFee)}</span>
          </div>
        )}
        {order.deliveryFee > 0 && (
          <div className="flex justify-between py-1.5 text-ink-900/60">
            <span>配送费</span>
            <span className="num">¥{fen(order.deliveryFee)}</span>
          </div>
        )}
        <div className="mt-1.5 flex items-baseline justify-between border-t border-black/[0.06] pt-2.5">
          <span className="text-[15.5px] font-semibold">实付</span>
          <span className="num text-[27px] font-bold">¥{fen(order.totalAmount)}</span>
        </div>
      </section>

      {isDelivery && order.address && (
        <section className="rounded-2xl bg-sky-50 p-4 text-[14.5px] leading-relaxed text-sky-900">
          <p className="flex items-center gap-1 font-medium">
            <Bike size={14} /> 配送信息
          </p>
          <p className="mt-1">
            {order.receiverName} · {order.receiverPhone}
          </p>
          <p className="mt-0.5 text-sky-700">{order.address}</p>
        </section>
      )}

      <section className="mt-3 space-y-2 rounded-2xl bg-white p-4 text-[15px]">
        <div className="flex justify-between gap-4">
          <span className="shrink-0 text-ink-900/45">订单号</span>
          <span className="num text-right text-ink-900/85">{order.orderNo}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-900/45">下单时间</span>
          <span className="text-ink-900/85">
            {clockOf(order.createdAt)}（{durationText(order.createdAt)}前）
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-900/45">支付状态</span>
          <span className="text-ink-900/85">{order.payStatusText}</span>
        </div>
        {order.peopleCount ? (
          <div className="flex justify-between">
            <span className="text-ink-900/45">用餐人数</span>
            <span className="text-ink-900/85">{order.peopleCount} 人</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** 老板台账单详情：整屏显示，左右滑动切换上一单/下一单 */
export function BossOrderDetail({
  orders,
  index,
  acting,
  onClose,
  onIndexChange,
  onAccept,
  onReady,
  onUndoReady,
}: {
  orders: Order[];
  index: number;
  acting: string;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onAccept: (order: Order) => void;
  onReady: (order: Order) => void;
  onUndoReady: (order: Order) => void;
}) {
  const pagerRef = useRef<HTMLDivElement>(null);
  const tapRef = useRef({ x: 0, y: 0, skip: false, last: 0 });
  // 程序触发的平滑滚动期间忽略 onScroll，避免索引被来回改写
  const programmaticRef = useRef(false);
  const current = orders[Math.min(index, orders.length - 1)];

  // 首次进入时定位到目标订单
  useEffect(() => {
    const el = pagerRef.current;
    if (!el) return;
    el.scrollLeft = index * el.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切到下一单自动把上一单标为出餐完成
  const lastIndexRef = useRef(index);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  useEffect(() => {
    const prevIndex = lastIndexRef.current;
    if (index === prevIndex) return;
    lastIndexRef.current = index;
    if (index <= prevIndex) return;
    const prevOrder = ordersRef.current[prevIndex];
    if (prevOrder && prevOrder.status === 'PREPARING') onReady(prevOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  if (!current) return null;

  const goTo = (next: number) => {
    const el = pagerRef.current;
    if (!el) return;
    const target = Math.max(0, Math.min(orders.length - 1, next));
    if (target === index) return;
    programmaticRef.current = true;
    el.scrollTo({ left: target * el.clientWidth, behavior: 'smooth' });
    onIndexChange(target);
    window.setTimeout(() => {
      programmaticRef.current = false;
    }, 450);
  };

  /** 只在滚动基本停稳到某一页时才切换，避免一划就跳过好几单 */
  const onScroll = () => {
    if (programmaticRef.current) return;
    const el = pagerRef.current;
    if (!el || !el.clientWidth) return;
    const ratio = el.scrollLeft / el.clientWidth;
    const next = Math.round(ratio);
    if (Math.abs(ratio - next) < 0.1 && next !== index && next >= 0 && next < orders.length) {
      onIndexChange(next);
    }
  };

  /** 双击（含指关节双击）切换下一单：记录两次轻点的间隔 */
  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea')) {
      tapRef.current.skip = true;
      return;
    }
    const touch = event.touches[0];
    tapRef.current.x = touch.clientX;
    tapRef.current.y = touch.clientY;
    tapRef.current.skip = false;
  };

  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (tapRef.current.skip) return;
    const touch = event.changedTouches[0];
    if (Math.abs(touch.clientX - tapRef.current.x) > 12 || Math.abs(touch.clientY - tapRef.current.y) > 12) {
      tapRef.current.last = 0;
      return;
    }
    const now = Date.now();
    if (now - tapRef.current.last < 320) {
      tapRef.current.last = 0;
      goTo(index + 1);
    } else {
      tapRef.current.last = now;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#F6F1EA]">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-black/5 bg-[#FBF7F2]/95 px-3 backdrop-blur">
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-ink-900/60 active:bg-black/5"
          aria-label="返回订单列表"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <p className="text-[17px] font-semibold leading-tight">订单详情</p>
          <p className="text-[12.5px] text-ink-900/40">
            第 {index + 1} / {orders.length} 单 · 切换自动出餐
          </p>
        </div>
        <span className={cn('rounded-full px-3 py-1 text-[13.5px] font-medium', statusClass(current.status))}>
          {STATUS_TEXT[current.status] || current.status}
        </span>
      </header>

      <div
        ref={pagerRef}
        onScroll={onScroll}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="no-scrollbar flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
      >
        {orders.map((order) => (
          <div
            key={order.id}
            style={{ scrollSnapStop: 'always' }}
            className="h-full w-full shrink-0 snap-start overflow-y-auto"
          >
            <OrderPane order={order} />
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-black/5 bg-white px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
        {current.status === 'PENDING' ? (
          <button
            type="button"
            onClick={() => onAccept(current)}
            disabled={acting === current.id + 'accept'}
            className="flex h-12 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl text-[16px] font-semibold text-white disabled:opacity-60"
            style={{ backgroundImage: 'linear-gradient(180deg, var(--brand), var(--brand-dark))' }}
          >
            <ChefHat size={17} />
            接单
          </button>
        ) : current.status === 'PREPARING' ? (
          <button
            type="button"
            onClick={() => onReady(current)}
            disabled={acting === current.id + 'ready'}
            className="flex h-12 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-ink-900 text-[16px] font-semibold text-white disabled:opacity-60"
          >
            <Check size={17} />
            出餐完成
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onUndoReady(current)}
              className="flex h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-brand/40 bg-brand-light text-[16px] font-semibold text-brand"
            >
              <Undo2 size={17} />
              取消出餐
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-black/5 text-[16px] font-semibold text-ink-900/60"
            >
              <Utensils size={16} />
              返回订单列表
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
