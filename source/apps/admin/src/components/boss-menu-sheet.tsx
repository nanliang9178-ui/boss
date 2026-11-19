import { useMemo, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { cn, fen } from '../lib/utils';
import type { Category, Product } from '../lib/types';

/** 老板台：整屏「我的菜品」，在售 / 卖完了 一键切换 */
export function BossMenuSheet({
  products,
  categories,
  acting,
  onClose,
  onToggle,
}: {
  products: Product[];
  categories: Category[];
  acting: string;
  onClose: () => void;
  onToggle: (product: Product) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [tab, setTab] = useState('ALL');

  const list = useMemo(() => {
    const key = keyword.trim();
    return products.filter((product) => {
      if (tab !== 'ALL' && product.categoryId !== tab) return false;
      if (!key) return true;
      return product.name.includes(key);
    });
  }, [products, keyword, tab]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#F6F1EA]">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-black/5 bg-[#FBF7F2]/95 px-3 backdrop-blur">
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-ink-900/60 active:bg-black/5"
          aria-label="返回"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <p className="text-[16px] font-semibold leading-tight">我的菜品</p>
          <p className="text-[11.5px] text-ink-900/40">共 {products.length} 个 · 点右侧按钮切换售卖状态</p>
        </div>
      </header>

      <div className="shrink-0 border-b border-black/5 bg-[#FBF7F2] px-3 pb-2.5 pt-2">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-900/30" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索菜品名称"
            className="h-10 w-full rounded-xl border-0 bg-white pl-9 pr-3 text-[14px] text-ink-900 shadow-sm outline-none placeholder:text-ink-900/30"
          />
        </div>

        <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setTab('ALL')}
            className={cn(
              'shrink-0 cursor-pointer rounded-full px-3 py-1.5 text-[12.5px] transition',
              tab === 'ALL' ? 'bg-ink-900 font-semibold text-white' : 'bg-black/[0.05] text-ink-900/55',
            )}
          >
            全部
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setTab(category.id)}
              className={cn(
                'shrink-0 cursor-pointer rounded-full px-3 py-1.5 text-[12.5px] transition',
                tab === category.id ? 'bg-ink-900 font-semibold text-white' : 'bg-black/[0.05] text-ink-900/55',
              )}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="divide-y divide-black/[0.05] rounded-2xl bg-white px-3">
          {list.map((product) => (
            <div key={product.id} className="flex items-center gap-3 py-3">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="h-14 w-14 shrink-0 rounded-xl object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-cream text-xl">🍲</div>
              )}

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'truncate text-[15px] font-medium leading-snug',
                    product.soldOut ? 'text-ink-900/35' : 'text-ink-900',
                  )}
                >
                  {product.name}
                </p>
                <p className="num mt-1 text-[12.5px] text-ink-900/45">
                  ¥{fen(product.price)}
                  <span className="ml-2 font-sans">月售 {product.monthlySales}</span>
                </p>
              </div>

              <button
                type="button"
                onClick={() => onToggle(product)}
                disabled={acting === product.id}
                className={cn(
                  'shrink-0 cursor-pointer rounded-full px-3.5 py-2 text-[12.5px] font-medium ring-1 ring-inset transition active:scale-95 disabled:opacity-50',
                  product.soldOut
                    ? 'bg-ink-900/5 text-ink-900/45 ring-black/[0.06]'
                    : 'bg-emerald-50 text-emerald-700 ring-emerald-200',
                )}
              >
                {product.soldOut ? '卖完了' : '在售'}
              </button>
            </div>
          ))}

          {list.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 py-12 text-ink-900/35">
              <Search size={20} />
              <p className="text-[13px]">没有匹配的菜品</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
