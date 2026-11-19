﻿﻿﻿import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Bike, Check, ChefHat, ChevronRight, Monitor, RefreshCw, Store as StoreIcon, Utensils } from 'lucide-react';
import { api } from '../lib/api';
import { BossMenuSheet } from '../components/boss-menu-sheet';
import { BossOrderDetail } from '../components/boss-order-detail';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { cn, durationText, fen, fenShort } from '../lib/utils';
import type { Category, DashboardData, Order, Product } from '../lib/types';

const ACTIVE_STATUS = ['PENDING', 'PREPARING'];

const STATUS_TEXT: Record<string, string> = {
  UNPAID: '待支付',
  PENDING: '待接单',
  PREPARING: '制作中',
  READY: '待取餐',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

function clockOf(input: string): string {
  const date = new Date(input);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function todayLabel(): string {
  const date = new Date();
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export default function BossPage() {
  const { me, logout, refresh } = useAuth();
  const toast = useToast();

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderTab, setOrderTab] = useState<'active' | 'all'>('active');
  const [detailId, setDetailId] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState('');

  const store = me?.store;
  const isOpen = store?.openStatus !== false;

  // 品牌色跟随商户配置（白标）
  const brandColor = me?.brand?.primaryColor || '#FF5A1F';
  const brandDark = shadeHex(brandColor, -16);
  const brandVars = { '--brand': brandColor, '--brand-dark': brandDark } as CSSProperties;

  /** 轻量刷新：只拉订单（每秒执行） */
  const loadOrders = useCallback(async () => {
    const orderPage = await api.get<{ list: Order[]; total: number }>('/admin/orders', { page: 1, pageSize: 50 });
    setOrders(orderPage.list || []);
  }, []);

  /** 全量刷新：看板 + 菜品 + 分类 + 订单 */
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setRefreshing(true);
      try {
        const [dash, productList, categoryList] = await Promise.all([
          api.get<DashboardData>('/admin/stats/dashboard'),
          api.get<Product[]>('/admin/menu/products'),
          api.get<Category[]>('/admin/menu/categories'),
        ]);
        setDashboard(dash);
        setProducts(productList || []);
        setCategories(categoryList || []);
        await loadOrders();
      } catch (error: any) {
        if (!silent) toast.error(error?.message || '数据加载失败');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [toast, loadOrders],
  );

  useEffect(() => {
    load();
    // 订单每秒刷新；菜品与看板 60 秒刷新一次，避免无谓请求
    const fast = window.setInterval(() => {
      loadOrders().catch(() => undefined);
    }, 1000);
    const slow = window.setInterval(() => {
      load(true).catch(() => undefined);
    }, 60000);
    return () => {
      window.clearInterval(fast);
      window.clearInterval(slow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (order: Order, action: 'accept' | 'ready') => {
    setActing(order.id + action);
    try {
      await api.post(`/admin/orders/${order.id}/${action}`);
      toast.success(action === 'accept' ? '已接单' : '已出餐');
      await loadOrders();
    } catch (error: any) {
      toast.error(error?.message || '操作失败');
    } finally {
      setActing('');
    }
  };

  const undoReady = async (order: Order) => {
    try {
      await api.post(`/admin/orders/${order.id}/undo-ready`);
      toast.success('已撤销出餐');
      await loadOrders();
    } catch (error: any) {
      toast.error(error?.message || '撤销出餐失败');
    }
  };

  const toggleSoldOut = async (product: Product) => {
    setActing(product.id);
    try {
      await api.patch(`/admin/menu/products/${product.id}/availability`, { soldOut: !product.soldOut });
      setProducts((list) => list.map((item) => (item.id === product.id ? { ...item, soldOut: !item.soldOut } : item)));
      toast.success(product.soldOut ? '已恢复售卖' : '已标记卖完了');
    } catch (error: any) {
      toast.error(error?.message || '操作失败');
    } finally {
      setActing('');
    }
  };

  const toggleOpen = async () => {
    try {
      await api.put('/admin/store', { openStatus: !isOpen });
      await refresh();
      toast.success(!isOpen ? '已开始接单' : '已暂停接单');
    } catch (error: any) {
      toast.error(error?.message || '操作失败');
    }
  };

  const activeOrders = useMemo(() => orders.filter((order) => ACTIVE_STATUS.includes(order.status)), [orders]);
  const pendingCount = activeOrders.filter((order) => order.status === 'PENDING').length;

  /** 堂食与打包不再分组，统一按取餐号升序排列 */
  const visibleOrders = useMemo(() => {
    const source = orderTab === 'active' ? activeOrders : orders;
    return [...source].sort((a, b) => {
      const na = a.pickupNo ?? Number.MAX_SAFE_INTEGER;
      const nb = b.pickupNo ?? Number.MAX_SAFE_INTEGER;
      if (na !== nb) return na - nb;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }, [orders, activeOrders, orderTab]);

  // 详情列表实时跟随当前订单列表，新单到达后可直接滑到下一单
  const detailOrders = useMemo(() => {
    if (!detailId) return [] as Order[];
    if (visibleOrders.some((order) => order.id === detailId)) return visibleOrders;
    const single = orders.find((order) => order.id === detailId);
    return single ? [single] : [];
  }, [detailId, visibleOrders, orders]);

  const detailIndex = Math.max(
    detailOrders.findIndex((order) => order.id === detailId),
    0,
  );

  const openDetail = (order: Order) => setDetailId(order.id);

  return (
    <div className="min-h-screen bg-[#F6F1EA] pb-16" style={brandVars}>
      {/* 顶部栏 */}
      <header className="sticky top-0 z-20 border-b border-black/[0.06] bg-[#FBF7F2]/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[560px] items-center gap-3 px-4">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold text-white"
            style={{ backgroundImage: 'linear-gradient(135deg, var(--brand), var(--brand-dark))' }}
          >
            {(store?.name || '店').slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold leading-tight text-ink-900">{store?.name || '我的门店'}</p>
            <p className="text-[11px] text-ink-900/40">{todayLabel()} · 老板台</p>
          </div>
          <button
            type="button"
            onClick={toggleOpen}
            className={cn(
              'cursor-pointer rounded-full px-3 py-1.5 text-[11px] font-medium ring-1 ring-inset transition',
              isOpen
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                : 'bg-amber-50 text-amber-700 ring-amber-200',
            )}
          >
            {isOpen ? '接单中' : '已打烊'}
          </button>
          <Link
            to="/"
            className="flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] text-ink-900/45 transition hover:bg-black/5 hover:text-ink-900"
            title="进入完整商户后台"
          >
            <Monitor size={14} />
            后台
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[560px] space-y-4 px-4 pt-4">
        {/* 今日盈利 */}
        <section
          className="relative overflow-hidden rounded-[26px] p-5 text-white shadow-[0_18px_40px_-24px_rgba(23,24,28,0.55)]"
          style={{ backgroundImage: 'linear-gradient(140deg, var(--brand), var(--brand-dark))' }}
        >
          <div className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-white/15" />
          <div className="pointer-events-none absolute -bottom-16 -left-6 h-36 w-36 rounded-full bg-white/10" />
          <p className="relative text-[12px] tracking-wide text-white/75">今日盈利（已收款）</p>
          <div className="relative mt-1 flex items-end gap-2">
            <span className="text-[22px] font-semibold leading-none">¥</span>
            <span className="num text-[46px] font-bold leading-none tracking-tight">
              {fenShort(dashboard?.today.amount || 0)}
            </span>
          </div>
          <div className="relative mt-5 grid grid-cols-3 gap-2">
            <div>
              <p className="text-[11px] text-white/65">订单数</p>
              <p className="num mt-0.5 text-[17px] font-semibold">{dashboard?.today.count || 0}</p>
            </div>
            <div>
              <p className="text-[11px] text-white/65">客单价</p>
              <p className="num mt-0.5 text-[17px] font-semibold">¥{fenShort(dashboard?.today.avgPrice || 0)}</p>
            </div>
            <div>
              <p className="text-[11px] text-white/65">待做</p>
              <p className="num mt-0.5 text-[17px] font-semibold">{activeOrders.length}</p>
            </div>
          </div>
        </section>

                        {/* 订单：堂食 / 打包 左右滑动切换 */}
        <section>
          <div className="mb-2 flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-ink-900">订单</h2>
              <div className="flex rounded-full bg-black/[0.05] p-0.5">
                {[
                  { key: 'active' as const, label: `待做 ${activeOrders.length}` },
                  { key: 'all' as const, label: `全部 ${orders.length}` },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setOrderTab(item.key)}
                    className={cn(
                      'cursor-pointer rounded-full px-2.5 py-1 text-[11px] transition',
                      orderTab === item.key ? 'bg-white font-semibold text-ink-900 shadow-sm' : 'text-ink-900/45',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {pendingCount > 0 && orderTab === 'active' && (
                <span
                  className="num rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  {pendingCount} 新
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => load(true)}
              className="flex cursor-pointer items-center gap-1 text-[11px] text-ink-900/40"
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              1 秒刷新
            </button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1].map((item) => (
                <div key={item} className="skeleton h-28 rounded-2xl" />
              ))}
            </div>
          ) : visibleOrders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl bg-white/80 py-10 ring-1 ring-inset ring-black/[0.04]">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <Utensils size={18} />
              </div>
              <p className="text-[13px] text-ink-900/50">
                {orderTab === 'active' ? '当前没有待做的订单' : '今天还没有订单'}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {visibleOrders.map((order) => {
                        const isDelivery = order.type === 'DELIVERY';
                        const isTakeaway = order.type === 'TAKEAWAY';
                        const isActive = ACTIVE_STATUS.includes(order.status);
                        return (
                          <article
                            key={order.id}
                            onClick={() => openDetail(order)}
                            className={cn(
                              'cursor-pointer rounded-2xl bg-white p-4 ring-1 ring-inset transition active:scale-[0.995]',
                              order.status === 'PENDING'
                                ? 'ring-brand-200 shadow-[0_10px_26px_-22px_rgba(255,90,31,0.9)]'
                                : 'ring-black/[0.05]',
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={cn(
                                    'num rounded-lg px-2 py-1 text-[12px] font-semibold text-white',
                                    isDelivery ? 'bg-sky-500' : isTakeaway ? 'bg-blue-600' : 'bg-ink-900',
                                  )}
                                >
                                  {isDelivery ? '外卖' : isTakeaway ? '打包' : order.tableName || '堂食'}
                                </span>
                                {!isDelivery && order.pickupNo && (
                                  <span className="num text-[11px] text-ink-900/35">#{order.pickupNo}</span>
                                )}
                                <span
                                  className={cn(
                                    'rounded-full px-2 py-0.5 text-[10px] font-medium',
                                    order.status === 'PENDING' && 'bg-brand/10 text-brand',
                                    order.status === 'PREPARING' && 'bg-amber-50 text-amber-700',
                                    order.status === 'READY' && 'bg-sky-50 text-sky-700',
                                    order.status === 'COMPLETED' && 'bg-emerald-50 text-emerald-700',
                                    (order.status === 'CANCELLED' || order.status === 'UNPAID') &&
                                      'bg-black/5 text-ink-900/40',
                                  )}
                                >
                                  {STATUS_TEXT[order.status] || order.status}
                                </span>
                              </div>
                              <span className="num text-[11px] text-ink-900/35">
                                {isActive ? durationText(order.createdAt) : clockOf(order.createdAt)}
                              </span>
                            </div>

                            <div className="mt-2.5 space-y-1">
                              {order.items.slice(0, 3).map((item) => (
                                <div key={item.id} className="flex items-center gap-2 text-[12.5px]">
                                  <span className="num shrink-0 text-ink-900/35">{item.quantity}×</span>
                                  <span className="truncate text-ink-900/75">{item.productName}</span>
                                  {item.specText && (
                                    <span className="hidden truncate text-[10.5px] text-ink-900/30 sm:inline">
                                      {item.specText}
                                    </span>
                                  )}
                                </div>
                              ))}
                              {order.items.length > 3 && (
                                <p className="text-[11px] text-ink-900/30">等 {order.items.length} 项商品</p>
                              )}
                            </div>

                            {order.remark && (
                              <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[11.5px] text-amber-700">
                                备注：{order.remark}
                              </p>
                            )}

                            {isDelivery && order.address && (
                              <p className="mt-2 flex items-start gap-1 rounded-lg bg-sky-50 px-2 py-1.5 text-[11.5px] text-sky-800">
                                <Bike size={12} className="mt-0.5 shrink-0" />
                                <span className="flex-1">
                                  {order.receiverName} {order.receiverPhone}
                                  <br />
                                  {order.address}
                                </span>
                              </p>
                            )}

                            <div className="mt-3 flex items-center justify-between border-t border-black/[0.05] pt-3">
                              <div className="flex items-baseline gap-1.5">
                                <span className="num text-[18px] font-bold text-ink-900">¥{fen(order.totalAmount)}</span>
                                <span className="text-[11px] text-ink-900/35">共 {order.itemCount} 件</span>
                              </div>
                              {order.status === 'PENDING' ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    act(order, 'accept');
                                  }}
                                  disabled={acting === order.id + 'accept'}
                                  className="flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_18px_-10px_rgba(23,24,28,0.5)] active:scale-[0.98] disabled:opacity-60"
                                  style={{ backgroundImage: 'linear-gradient(180deg, var(--brand), var(--brand-dark))' }}
                                >
                                  <ChefHat size={14} />
                                  接单
                                </button>
                              ) : order.status === 'PREPARING' ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    act(order, 'ready');
                                  }}
                                  disabled={acting === order.id + 'ready'}
                                  className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-ink-900 px-4 py-2 text-[13px] font-semibold text-white active:scale-[0.98] disabled:opacity-60"
                                >
                                  <Check size={14} />
                                  出餐完成
                                </button>
                              ) : (
                                <span className="text-[11px] text-ink-900/30">{clockOf(order.createdAt)} 下单</span>
                              )}
                            </div>
                          </article>
                        );
                      })}
            </div>
          )}
        </section>

        {/* 我的菜品：点击进入整屏菜品页 */}
        <section>
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-[15px] font-semibold text-ink-900">
              我的菜品
              <span className="num ml-1 text-[11px] font-normal text-ink-900/35">{products.length} 个</span>
            </h2>
            <Link to="/menu" className="text-[11px] text-brand-600">
              新增 / 编辑 →
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex w-full cursor-pointer items-center gap-3 rounded-2xl bg-white p-4 text-left ring-1 ring-inset ring-black/[0.05] transition active:scale-[0.995]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F7F2EC] text-ink-900/55">
              <StoreIcon size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-ink-900">查看全部菜品</p>
              <p className="mt-0.5 text-[12px] text-ink-900/40">一键切换 在售 / 卖完了</p>
            </div>
            <ChevronRight size={18} className="shrink-0 text-ink-900/25" />
          </button>
        </section>

        <div className="flex items-center justify-between px-1 pt-2 text-[11px] text-ink-900/30">
          <span>订单每秒自动刷新</span>
          <button type="button" onClick={logout} className="cursor-pointer hover:text-ink-900/60">
            退出登录
          </button>
        </div>
      </main>

      {detailId && detailOrders.length > 0 && (
        <BossOrderDetail
          orders={detailOrders}
          index={detailIndex}
          acting={acting}
          onClose={() => setDetailId('')}
          onIndexChange={(index) => {
            const next = detailOrders[index];
            if (next) setDetailId(next.id);
          }}
          onAccept={(order) => act(order, 'accept')}
          onReady={(order) => act(order, 'ready')}
          onUndoReady={undoReady}
        />
      )}

      {menuOpen && (
        <BossMenuSheet
          products={products}
          categories={categories}
          acting={acting}
          onClose={() => setMenuOpen(false)}
          onToggle={toggleSoldOut}
        />
      )}
    </div>
  );
}

/** 把品牌色按百分比调暗，用于生成渐变的深色端 */
function shadeHex(hex: string, percent: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const value = parseInt(clean, 16);
  const delta = Math.round((255 * percent) / 100);
  const parts = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) =>
    Math.max(0, Math.min(255, c + delta)),
  );
  return `#${parts.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}