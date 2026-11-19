/*!
 * 天枢点单 · 演示数据层（浏览器内 Mock API）
 * ---------------------------------------------------------------
 * 本文件只做一件事：用安装包自带 app.db 导出的真实种子数据，
 * 在浏览器里复刻 apps/api 的 REST 接口行为，让安装包原样构建的
 * 前端（h5 顾客端 / admin 商户后台）无需连接后端即可完整演示。
 * 接口路径、请求体、响应结构、状态机、金额与统计口径全部照抄
 * 安装包 apps/api 与 packages/shared 的实现。
 */
(function () {
  'use strict';
  if (window.__T4_SHIM__) return;
  window.__T4_SHIM__ = true;

  var SEED = window.__T4_SEED__ || null;
  var DB_KEY = 't4_db_v1';
  var CONSUME_BASE = location.origin + '/Consume';
  var BC = null;
  try { BC = new BroadcastChannel('t4_demo_sync'); } catch (e) { BC = null; }

  /* ------------------------------ 基础工具 ------------------------------ */
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function uid(prefix) { return (prefix || 'id') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function nowIso() { return new Date().toISOString(); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dayStart(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
  function dayEnd(d) { var x = new Date(d); x.setHours(23, 59, 59, 999); return x.getTime(); }

  /* ------------------------------ 状态机（照抄 packages/shared） ------------------------------ */
  var TRANSITIONS = {
    UNPAID: ['PENDING', 'CANCELLED'],
    PENDING: ['PREPARING', 'CANCELLED'],
    PREPARING: ['READY', 'CANCELLED'],
    READY: ['COMPLETED'],
    COMPLETED: [],
    CANCELLED: []
  };
  var APPENDABLE = ['PENDING', 'PREPARING', 'READY'];
  var REFUNDABLE = ['PENDING', 'PREPARING', 'READY', 'COMPLETED'];
  var CUSTOMER_CANCELLABLE = ['UNPAID', 'PENDING'];
  var ORDER_STATUS_TEXT = { UNPAID: '待支付', PENDING: '待接单', PREPARING: '制作中', READY: '待取餐', COMPLETED: '已完成', CANCELLED: '已取消' };
  var PAY_STATUS_TEXT = { UNPAID: '未支付', PAID: '已支付', REFUNDING: '退款中', REFUNDED: '已退款', CLOSED: '已关闭' };

  function canTransition(from, to) { return (TRANSITIONS[from] || []).indexOf(to) >= 0; }
  function canRefund(status) { return REFUNDABLE.indexOf(status) >= 0; }
  function canAppendItems(status) { return APPENDABLE.indexOf(status) >= 0; }
  function canCustomerCancel(status) { return CUSTOMER_CANCELLABLE.indexOf(status) >= 0; }

  /* ------------------------------ 种子数据（来自安装包 app.db） ------------------------------ */
  function materialize() {
    var seed = clone(SEED);
    var now = Date.now();
    var todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    var elapsedToday = Math.max(0, now - todayStart.getTime());
    var anchor = now;
    seed.orders.forEach(function (o, idx) {
      var base = anchor - (o._ageH || 24) * 3600 * 1000;
      // 深夜/凌晨访问时，较近的订单会落到昨天：把它们压回今天，保证看板“今日”有数据且订单时间都在过去
      if (base < todayStart.getTime() && (o._ageH || 24) <= 24) {
        base = todayStart.getTime() + Math.min(idx * 2 * 60 * 1000 + 60 * 1000, Math.max(20 * 1000, elapsedToday * 0.6));
      }
      o.createdAt = new Date(base).toISOString();
      if (o._has_paidAt) o.paidAt = new Date(base + 30 * 1000).toISOString();
      if (o._has_acceptAt) o.acceptAt = new Date(base + 60 * 1000).toISOString();
      if (o._has_readyAt) o.readyAt = new Date(base + 12 * 60 * 1000).toISOString();
      if (o._has_completeAt) o.completeAt = new Date(base + 35 * 60 * 1000).toISOString();
      if (o._has_cancelAt) o.cancelAt = new Date(base + 10 * 60 * 1000).toISOString();
      o.updatedAt = o.completeAt || o.cancelAt || o.readyAt || o.acceptAt || o.paidAt || o.createdAt;
      delete o._ageH;
      delete o._has_paidAt; delete o._has_acceptAt; delete o._has_readyAt;
      delete o._has_completeAt; delete o._has_cancelAt;
      o.items = (o.items || []).map(function (it) { it.orderId = o.id; return it; });
    });
    var maxPickup = 0;
    seed.orders.forEach(function (o) { if (o.pickupNo > maxPickup) maxPickup = o.pickupNo; });
    return {
      v: 4,
      createdAt: new Date().toISOString(),
      tenant: seed.tenant,
      brand: seed.brand,
      store: seed.store,
      staff: seed.staff,
      platform: seed.platform,
      customers: seed.customers || [],
      tables: seed.tables,
      categories: seed.categories,
      products: seed.products,
      orders: seed.orders,
      pay: seed.pay,
      platformData: seed.platformData,
      seq: { pickupNo: maxPickup + 1, orderNo: 1 }
    };
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(DB_KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var db = JSON.parse(raw);
        if (db && db.v === 4) {
          // 演示库超过 12 小时自动回到“新鲜”种子（订单时间保持贴近当前）
          if (Date.now() - new Date(db.createdAt).getTime() > 12 * 3600 * 1000) {
            localStorage.removeItem(DB_KEY);
          } else {
            return db;
          }
        }
      } catch (e) { /* fallthrough */ }
    }
    var db = materialize();
    save(db, { publish: false });
    return db;
  }

  function save(db, opts) {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { /* ignore */ }
    if (BC) { try { BC.postMessage({ type: 'sync', at: Date.now() }); } catch (e) { /* ignore */ } }
    if (!opts || opts.publish !== false) schedulePublish();
  }

  /* ------------------------------ 金额与订单序列化（照抄 order.service / order.serializer） ------------------------------ */
  function itemCount(order) {
    return (order.items || []).reduce(function (sum, it) { return sum + it.quantity; }, 0);
  }

  function allowedActions(order) {
    var paid = order.payStatus === 'PAID';
    return {
      accept: order.status === 'PENDING',
      reject: order.status === 'PENDING',
      ready: order.status === 'PREPARING',
      complete: order.status === 'READY',
      refund: paid && canRefund(order.status),
      append: paid && canAppendItems(order.status),
      customerCancel: canCustomerCancel(order.status),
      pay: order.status === 'UNPAID'
    };
  }

  function serializeOrder(order) {
    var out = clone(order);
    out.statusText = ORDER_STATUS_TEXT[order.status] || order.status;
    out.payStatusText = PAY_STATUS_TEXT[order.payStatus] || order.payStatus;
    out.itemCount = itemCount(order);
    out.nextStatuses = TRANSITIONS[order.status] || [];
    out.allowedActions = allowedActions(order);
    if (!out.refunds) out.refunds = [];
    return out;
  }

  function priceItems(db, items) {
    var priced = [];
    var itemAmount = 0;
    (items || []).forEach(function (line) {
      var product = db.products.find(function (p) { return p.id === line.productId; });
      if (!product) throw httpError(400, '菜品不存在或已下架');
      if (product.status !== 'ON' || product.soldOut) throw httpError(400, '「' + product.name + '」已售罄');
      if (product.stockEnabled && product.stock < line.quantity) throw httpError(400, '「' + product.name + '」库存不足');
      var unitPrice = product.price;
      var specTexts = [];
      (product.specGroups || []).forEach(function (group) {
        var selected = (group.options || []).filter(function (opt) {
          return (line.specOptionIds || []).indexOf(opt.id) >= 0;
        });
        if (!selected.length) {
          var dft = (group.options || []).filter(function (opt) { return opt.defaultSelected; });
          if (group.required && dft.length) selected = dft.slice(0, 1);
        }
        selected.forEach(function (opt) { unitPrice += opt.priceDelta || 0; });
        if (selected.length) {
          specTexts.push(group.name + ':' + selected.map(function (o) { return o.name; }).join('+'));
        }
      });
      var amount = unitPrice * line.quantity;
      itemAmount += amount;
      priced.push({
        id: uid('oi'),
        orderId: '',
        tenantId: db.tenant.id,
        productId: product.id,
        productName: product.name,
        imageUrl: product.imageUrl || null,
        unitPrice: unitPrice,
        quantity: line.quantity,
        amount: amount,
        specText: specTexts.length ? specTexts.join(' / ') : null,
        addonText: null,
        remark: line.remark || null
      });
    });
    return { items: priced, itemAmount: itemAmount };
  }

  function computeTotals(db, itemAmount, type) {
    var store = db.store;
    var discountAmount = (store.fullReduceThreshold > 0 && itemAmount >= store.fullReduceThreshold) ? store.fullReduceAmount : 0;
    var packingFee = type === 'TAKEAWAY' ? (store.packingFee || 0) : 0;
    var deliveryFee = type === 'DELIVERY' ? (store.deliveryFee || 0) : 0;
    var totalAmount = Math.max(0, itemAmount - discountAmount + packingFee + deliveryFee);
    return { discountAmount: discountAmount, packingFee: packingFee, deliveryFee: deliveryFee, totalAmount: totalAmount };
  }

  function buildOrderNo(db) {
    var d = new Date();
    var ymd = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    var rand = String(Math.floor(Math.random() * 90000000) + 10000000);
    return ymd + rand;
  }

  function serializeTable(db, t) {
    var base = CONSUME_BASE;
    var out = clone(t);
    out.qrContent = base + '/t/' + t.sceneCode;
    out.h5Url = out.qrContent;
    out.qrCodeUrl = t.qrCodeUrl || null;
    return out;
  }

  function publicBaseUrl() { return CONSUME_BASE; }

  /* ------------------------------ 认证 ------------------------------ */
  function staffMe(db, staff) {
    return {
      type: 'staff',
      name: staff.name,
      username: staff.username,
      role: staff.role,
      tenant: db.tenant,
      brand: db.brand,
      store: db.store
    };
  }

  function platformMe(db) {
    return { type: 'platform', name: db.platform.name, username: db.platform.username, role: 'PLATFORM', tenant: null, brand: null, store: null };
  }

  function authOf(req) {
    var h = req.headers || {};
    var raw = h.Authorization || h.authorization || '';
    if (!raw && h.get) raw = h.get('Authorization') || '';
    var m = /^Bearer\s+(.+)$/.exec(String(raw || ''));
    return m ? m[1] : '';
  }

  function requireStaff(db, req) {
    var token = authOf(req);
    if (token === 'mock-platform:' + db.platform.username) throw httpError(403, '当前登录为平台账号，无权访问商户后台');
    var name = token.indexOf('mock-staff:') === 0 ? token.slice('mock-staff:'.length) : '';
    var staff = db.staff.find(function (s) { return s.username === name; });
    if (!staff) throw httpError(401, '登录已过期，请重新登录');
    return staff;
  }

  function requirePlatform(db, req) {
    var token = authOf(req);
    if (token !== 'mock-platform:' + db.platform.username) throw httpError(401, '登录已过期，请重新登录');
    return db.platform;
  }

  function resolveCustomer(db, req) {
    var token = authOf(req);
    var id = token.indexOf('mock-h5:') === 0 ? token.slice('mock-h5:'.length) : '';
    var customer = db.customers.find(function (c) { return c.id === id; });
    if (!customer) throw httpError(401, '登录已过期，请重新扫码');
    return customer;
  }

  /* ------------------------------ 响应/错误 ------------------------------ */
  function httpError(status, message) {
    var err = new Error(message);
    err.__status = status;
    return err;
  }

  function respond(status, payload) {
    return new Response(JSON.stringify(payload), { status: status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
  function ok(data, status) { return respond(status || 200, { code: 0, message: 'ok', data: data === undefined ? null : data }); }
  function fail(status, message) { return respond(status, { code: status, message: message, data: null }); }

  /* ------------------------------ 统计（照抄 stats.service） ------------------------------ */
  function statsDashboard(db) {
    var now = new Date();
    var start = dayStart(now), end = dayStart(now) + 24 * 3600 * 1000;
    var yStart = start - 24 * 3600 * 1000;
    var paid = db.orders.filter(function (o) { return o.payStatus === 'PAID'; });
    function inRange(o, a, b) { var t = o.paidAt ? new Date(o.paidAt).getTime() : 0; return t >= a && t < b; }
    var todayOrders = paid.filter(function (o) { return inRange(o, start, end); });
    var yOrders = paid.filter(function (o) { return inRange(o, yStart, start); });
    var amount = todayOrders.reduce(function (s, o) { return s + (o.paidAmount || 0); }, 0);
    var yesterdayAmount = yOrders.reduce(function (s, o) { return s + (o.paidAmount || 0); }, 0);
    var trend = [];
    for (var i = 6; i >= 0; i--) {
      var a = start - i * 24 * 3600 * 1000;
      var b = a + 24 * 3600 * 1000;
      var list = paid.filter(function (o) { return inRange(o, a, b); });
      var d = new Date(a);
      trend.push({
        date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
        amount: list.reduce(function (s, o) { return s + (o.paidAmount || 0); }, 0),
        count: list.length
      });
    }
    var top = {};
    var sevenAgo = start - 6 * 24 * 3600 * 1000;
    paid.forEach(function (o) {
      if (!inRange(o, sevenAgo, end)) return;
      (o.items || []).forEach(function (it) {
        if (!top[it.productName]) top[it.productName] = { name: it.productName, quantity: 0, amount: 0 };
        top[it.productName].quantity += it.quantity;
        top[it.productName].amount += it.amount;
      });
    });
    var topProducts = Object.keys(top).map(function (k) { return top[k]; })
      .sort(function (a, b) { return b.quantity - a.quantity; }).slice(0, 8);
    var refundCount = db.orders.filter(function (o) {
      return o.payStatus === 'REFUNDED' && o.cancelAt && new Date(o.cancelAt).getTime() >= start;
    }).length;
    return {
      today: {
        amount: amount,
        count: todayOrders.length,
        avgPrice: todayOrders.length ? Math.round(amount / todayOrders.length) : 0,
        pendingCount: db.orders.filter(function (o) { return o.status === 'PENDING'; }).length,
        refundCount: refundCount,
        compareRate: yesterdayAmount > 0 ? Math.round(((amount - yesterdayAmount) / yesterdayAmount) * 1000) / 10 : null
      },
      yesterdayAmount: yesterdayAmount,
      trend: trend,
      topProducts: topProducts
    };
  }

  function statsOverview(db, from, to) {
    var fromT = dayStart(new Date(from)), toT = dayEnd(new Date(to));
    var paid = db.orders.filter(function (o) {
      if (o.payStatus !== 'PAID' || !o.paidAt) return false;
      var t = new Date(o.paidAt).getTime();
      return t >= fromT && t <= toT;
    });
    var amount = paid.reduce(function (s, o) { return s + (o.paidAmount || 0); }, 0);
    var itemQty = paid.reduce(function (s, o) {
      return s + (o.items || []).reduce(function (x, it) { return x + it.quantity; }, 0);
    }, 0);
    var daily = [];
    var hours = [];
    for (var h = 0; h < 24; h++) hours.push({ hour: h, amount: 0, count: 0 });
    var cursor = new Date(fromT);
    while (cursor.getTime() <= toT) {
      var a = dayStart(cursor), b = a + 24 * 3600 * 1000;
      var list = paid.filter(function (o) { var t = new Date(o.paidAt).getTime(); return t >= a && t < b; });
      daily.push({
        date: cursor.getFullYear() + '-' + pad(cursor.getMonth() + 1) + '-' + pad(cursor.getDate()),
        amount: list.reduce(function (s, o) { return s + (o.paidAmount || 0); }, 0),
        count: list.length
      });
      cursor = new Date(b);
    }
    paid.forEach(function (o) {
      var d = new Date(o.paidAt);
      var slot = hours[d.getHours()];
      slot.amount += o.paidAmount || 0;
      slot.count += 1;
    });
    var catMap = {};
    db.products.forEach(function (p) {
      var cat = db.categories.find(function (c) { return c.id === p.categoryId; });
      catMap[p.name] = cat ? cat.name : '其他';
    });
    var catAgg = {};
    paid.forEach(function (o) {
      (o.items || []).forEach(function (it) {
        var name = catMap[it.productName] || '其他';
        if (!catAgg[name]) catAgg[name] = { name: name, amount: 0, quantity: 0 };
        catAgg[name].amount += it.amount;
        catAgg[name].quantity += it.quantity;
      });
    });
    return {
      range: { from: from, to: to },
      summary: { amount: amount, count: paid.length, avgPrice: paid.length ? Math.round(amount / paid.length) : 0, itemCount: itemQty },
      daily: daily,
      hours: hours,
      categories: Object.keys(catAgg).map(function (k) { return catAgg[k]; })
    };
  }

  /* ------------------------------ 路由表 ------------------------------ */
  var routes = [];
  function route(method, pattern, handler) {
    var keys = [];
    var re = new RegExp('^' + pattern.replace(/:[A-Za-z]+/g, function (m) { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
    routes.push({ method: method, re: re, keys: keys, handler: handler });
  }

  /* ---------- 认证 ---------- */
  route('POST', '/api/auth/login', function (ctx) {
    var db = ctx.db;
    var b = ctx.body || {};
    if (b.tenantCode && b.tenantCode !== db.tenant.code) throw httpError(400, '商户编码不正确');
    var staff = db.staff.find(function (s) { return s.username === b.username; });
    if (!staff || staff.password !== b.password) throw httpError(400, '账号或密码错误');
    return ok({ token: 'mock-staff:' + staff.username, user: staffMe(db, staff) });
  });

  route('POST', '/api/auth/platform/login', function (ctx) {
    var db = ctx.db;
    var b = ctx.body || {};
    if (b.username !== db.platform.username || b.password !== db.platform.password) throw httpError(400, '账号或密码错误');
    return ok({ token: 'mock-platform:' + db.platform.username, user: platformMe(db) });
  });

  route('GET', '/api/auth/me', function (ctx) {
    var db = ctx.db;
    var token = authOf(ctx.req);
    if (token === 'mock-platform:' + db.platform.username) return ok(platformMe(db));
    return ok(staffMe(db, requireStaff(db, ctx.req)));
  });

  /* ---------- 商户：门店/品牌 ---------- */
  route('GET', '/api/admin/store', function (ctx) {
    requireStaff(ctx.db, ctx.req);
    return ok({ store: ctx.db.store, brand: ctx.db.brand });
  });

  route('PUT', '/api/admin/store', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var b = ctx.body || {};
    var patch = b.store || b;
    Object.keys(patch).forEach(function (k) { if (k in db.store) db.store[k] = patch[k]; });
    if (b.brand) Object.keys(b.brand).forEach(function (k) { if (k in db.brand) db.brand[k] = b.brand[k]; });
    save(db);
    return ok({ store: db.store, brand: db.brand });
  });

  /* ---------- 商户：分类 ---------- */
  route('GET', '/api/admin/menu/categories', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var list = db.categories.slice().sort(function (a, b) { return a.sort - b.sort; }).map(function (c) {
      var out = clone(c);
      out._count = { products: db.products.filter(function (p) { return p.categoryId === c.id; }).length };
      return out;
    });
    return ok(list);
  });

  route('POST', '/api/admin/menu/categories', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var b = ctx.body || {};
    var cat = {
      id: uid('cat'), tenantId: db.tenant.id, storeId: db.store.id,
      name: b.name || '新分类', icon: b.icon || '', promoLabel: b.promoLabel || null, promoTitle: b.promoTitle || null,
      sort: typeof b.sort === 'number' ? b.sort : db.categories.length, status: 'ON',
      createdAt: nowIso(), updatedAt: nowIso()
    };
    db.categories.push(cat);
    save(db);
    return ok(cat);
  });

  route('PUT', '/api/admin/menu/categories/:id', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var cat = db.categories.find(function (c) { return c.id === ctx.params.id; });
    if (!cat) throw httpError(404, '分类不存在');
    var b = ctx.body || {};
    ['name', 'icon', 'promoLabel', 'promoTitle', 'sort', 'status'].forEach(function (k) {
      if (b[k] !== undefined) cat[k] = b[k];
    });
    cat.updatedAt = nowIso();
    save(db);
    return ok(cat);
  });

  route('DELETE', '/api/admin/menu/categories/:id', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var idx = db.categories.findIndex(function (c) { return c.id === ctx.params.id; });
    if (idx < 0) throw httpError(404, '分类不存在');
    db.categories.splice(idx, 1);
    db.products = db.products.filter(function (p) { return p.categoryId !== ctx.params.id; });
    save(db);
    return ok({ ok: true });
  });

  /* ---------- 商户：菜品 ---------- */
  route('GET', '/api/admin/menu/products', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    return ok(db.products.slice().sort(function (a, b) { return a.sort - b.sort; }));
  });

  function applyProductBody(db, product, b) {
    var cat = db.categories.find(function (c) { return c.id === b.categoryId; });
    ['name', 'description', 'imageUrl', 'price', 'originalPrice', 'unit', 'tags', 'stockEnabled', 'stock', 'soldOut', 'status', 'sort'].forEach(function (k) {
      if (b[k] !== undefined) product[k] = b[k];
    });
    product.categoryId = b.categoryId || product.categoryId;
    if (cat) product.category = { id: cat.id, name: cat.name };
    if (b.specGroups !== undefined) product.specGroups = b.specGroups;
    product.updatedAt = nowIso();
    return product;
  }

  route('POST', '/api/admin/menu/products', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var b = ctx.body || {};
    var product = {
      id: uid('prod'), tenantId: db.tenant.id, storeId: db.store.id, categoryId: b.categoryId || (db.categories[0] && db.categories[0].id),
      name: b.name || '新菜品', description: b.description || '', imageUrl: b.imageUrl || null,
      price: typeof b.price === 'number' ? b.price : 0, originalPrice: b.originalPrice || null, unit: b.unit || '份',
      monthlySales: 0, tags: b.tags || '', stockEnabled: !!b.stockEnabled, stock: b.stock || 0, soldOut: !!b.soldOut,
      status: b.status || 'ON', sort: typeof b.sort === 'number' ? b.sort : db.products.length,
      createdAt: nowIso(), updatedAt: nowIso(), specGroups: b.specGroups || []
    };
    applyProductBody(db, product, { specGroups: product.specGroups });
    db.products.push(product);
    save(db);
    return ok(product);
  });

  route('PUT', '/api/admin/menu/products/:id', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var product = db.products.find(function (p) { return p.id === ctx.params.id; });
    if (!product) throw httpError(404, '菜品不存在');
    applyProductBody(db, product, ctx.body || {});
    save(db);
    return ok(product);
  });

  route('DELETE', '/api/admin/menu/products/:id', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var idx = db.products.findIndex(function (p) { return p.id === ctx.params.id; });
    if (idx < 0) throw httpError(404, '菜品不存在');
    db.products.splice(idx, 1);
    save(db);
    return ok({ ok: true });
  });

  route('PATCH', '/api/admin/menu/products/:id/availability', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var product = db.products.find(function (p) { return p.id === ctx.params.id; });
    if (!product) throw httpError(404, '菜品不存在');
    var b = ctx.body || {};
    if (b.soldOut !== undefined) product.soldOut = b.soldOut;
    if (b.status !== undefined) product.status = b.status;
    product.updatedAt = nowIso();
    save(db);
    return ok(product);
  });

  route('POST', '/api/admin/menu/products/:id/duplicate', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var product = db.products.find(function (p) { return p.id === ctx.params.id; });
    if (!product) throw httpError(404, '菜品不存在');
    var copy = clone(product);
    copy.id = uid('prod');
    copy.name = product.name + '（副本）';
    copy.createdAt = nowIso();
    copy.updatedAt = nowIso();
    db.products.push(copy);
    save(db);
    return ok(copy);
  });

  /* ---------- 商户：订单 ---------- */
  function filterOrders(db, query) {
    var list = db.orders.slice().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    if (query.status && query.status !== 'ALL') list = list.filter(function (o) { return o.status === query.status; });
    if (query.keyword) {
      var kw = String(query.keyword).toLowerCase();
      list = list.filter(function (o) {
        return String(o.orderNo).toLowerCase().indexOf(kw) >= 0 || String(o.tableName || '').toLowerCase().indexOf(kw) >= 0;
      });
    }
    return list;
  }

  route('GET', '/api/admin/orders', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var q = ctx.query;
    var page = Number(q.page || 1), pageSize = Number(q.pageSize || 20);
    var all = filterOrders(db, q);
    var counts = { CANCELLED: 0, COMPLETED: 0, PENDING: 0, PREPARING: 0, READY: 0 };
    db.orders.forEach(function (o) { if (counts[o.status] !== undefined) counts[o.status] += 1; });
    var slice = all.slice((page - 1) * pageSize, page * pageSize);
    return ok({ list: slice.map(serializeOrder), total: all.length, page: page, pageSize: pageSize, counts: counts });
  });

  route('GET', '/api/admin/orders/:id', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var order = db.orders.find(function (o) { return o.id === ctx.params.id; });
    if (!order) throw httpError(404, '订单不存在');
    return ok(serializeOrder(order));
  });

  function transitionTo(order, status, patch) {
    if (!canTransition(order.status, status)) {
      throw httpError(400, '订单当前状态为「' + ORDER_STATUS_TEXT[order.status] + '」，无法执行该操作');
    }
    order.status = status;
    if (patch) Object.keys(patch).forEach(function (k) { order[k] = patch[k]; });
    order.updatedAt = nowIso();
  }

  route('POST', '/api/admin/orders/:id/:action', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var order = db.orders.find(function (o) { return o.id === ctx.params.id; });
    if (!order) throw httpError(404, '订单不存在');
    var action = ctx.params.action;
    var b = ctx.body || {};
    if (action === 'accept') transitionTo(order, 'PREPARING', { acceptAt: nowIso() });
    else if (action === 'reject') transitionTo(order, 'CANCELLED', { cancelAt: nowIso(), cancelReason: b.reason || '商家拒单' });
    else if (action === 'ready') transitionTo(order, 'READY', { readyAt: nowIso() });
    else if (action === 'undo-ready') {
      if (order.status !== 'READY') throw httpError(400, '订单当前状态为「' + ORDER_STATUS_TEXT[order.status] + '」，无法执行该操作');
      order.status = 'PREPARING'; order.readyAt = null; order.updatedAt = nowIso();
    } else if (action === 'complete') transitionTo(order, 'COMPLETED', { completeAt: nowIso() });
    else if (action === 'cancel') {
      transitionTo(order, 'CANCELLED', { cancelAt: nowIso(), cancelReason: b.reason || '商家取消' });
      if (order.payStatus === 'PAID') { order.payStatus = 'REFUNDED'; order.paidAmount = 0; }
    } else if (action === 'refund') {
      if (order.payStatus !== 'PAID') throw httpError(400, '订单未支付，无需退款');
      order.payStatus = 'REFUNDED'; order.paidAmount = 0; order.updatedAt = nowIso();
    } else if (action === 'append') {
      throw httpError(400, '演示环境不支持加菜');
    } else {
      throw httpError(400, '未知操作：' + action);
    }
    save(db);
    return ok(serializeOrder(order));
  });

  /* ---------- 商户：桌位 ---------- */
  route('GET', '/api/admin/tables', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var list = db.tables.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    var areas = [];
    list.forEach(function (t) { if (areas.indexOf(t.area) < 0) areas.push(t.area); });
    return ok({
      total: list.length,
      areas: areas,
      publicBaseUrl: publicBaseUrl(),
      miniprogram: { configured: false, envVersion: 'release' },
      list: list.map(function (t) { return serializeTable(db, t); })
    });
  });

  route('POST', '/api/admin/tables', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var b = ctx.body || {};
    var table = {
      id: uid('tbl'), tenantId: db.tenant.id, storeId: db.store.id,
      sceneCode: b.sceneCode || uid('s').slice(-10).toLowerCase(),
      area: b.area || '大厅', name: b.name || ('新桌' + db.tables.length), seats: b.seats || 4,
      qrCodeUrl: null, createdAt: nowIso()
    };
    db.tables.push(table);
    save(db);
    return ok(serializeTable(db, table));
  });

  route('PUT', '/api/admin/tables/:id', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var table = db.tables.find(function (t) { return t.id === ctx.params.id; });
    if (!table) throw httpError(404, '桌位不存在');
    var b = ctx.body || {};
    ['name', 'area', 'seats', 'sceneCode', 'qrCodeUrl'].forEach(function (k) { if (b[k] !== undefined) table[k] = b[k]; });
    save(db);
    return ok(serializeTable(db, table));
  });

  route('DELETE', '/api/admin/tables/:id', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var idx = db.tables.findIndex(function (t) { return t.id === ctx.params.id; });
    if (idx < 0) throw httpError(404, '桌位不存在');
    db.tables.splice(idx, 1);
    save(db);
    return ok({ ok: true });
  });

  route('POST', '/api/admin/tables/batch', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var b = ctx.body || {};
    var count = Math.max(1, Math.min(50, Number(b.count) || 1));
    var start = Number(b.start) || 1;
    var created = [];
    for (var i = 0; i < count; i++) {
      var name = (b.prefix || 'A') + pad(start + i);
      var table = {
        id: uid('tbl'), tenantId: db.tenant.id, storeId: db.store.id,
        sceneCode: uid('s').slice(-10).toLowerCase(),
        area: b.area || '大厅', name: name, seats: Number(b.seats) || 4,
        qrCodeUrl: null, createdAt: nowIso()
      };
      db.tables.push(table);
      created.push(table);
    }
    save(db);
    return ok({ created: created.length, list: created.map(function (t) { return serializeTable(db, t); }) });
  });

  /* ---------- 商户：统计 ---------- */
  route('GET', '/api/admin/stats/dashboard', function (ctx) {
    requireStaff(ctx.db, ctx.req);
    return ok(statsDashboard(ctx.db));
  });

  route('GET', '/api/admin/stats/overview', function (ctx) {
    requireStaff(ctx.db, ctx.req);
    var q = ctx.query;
    var to = q.dateTo || new Date().toISOString().slice(0, 10);
    var fromDefault = new Date(new Date(to).getTime() - 6 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    return ok(statsOverview(ctx.db, q.dateFrom || fromDefault, to));
  });

  /* ---------- 商户：支付配置 ---------- */
  route('GET', '/api/admin/pay/config', function (ctx) {
    requireStaff(ctx.db, ctx.req);
    return ok(ctx.db.pay.config);
  });
  route('PUT', '/api/admin/pay/config', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    Object.keys(ctx.body || {}).forEach(function (k) { if (k in db.pay.config) db.pay.config[k] = ctx.body[k]; });
    db.pay.config.ready = !!(db.pay.config.mchId && db.pay.config.serialNo && db.pay.config.hasPrivateKey);
    save(db);
    return ok(db.pay.config);
  });
  route('POST', '/api/admin/pay/config/test', function (ctx) {
    requireStaff(ctx.db, ctx.req);
    return ok({ ok: true, message: '演示环境：未接入真实微信支付，当前使用模拟支付（ALLOW_MOCK_PAY=true）' });
  });
  route('GET', '/api/admin/pay/miniprogram', function (ctx) {
    requireStaff(ctx.db, ctx.req);
    return ok(ctx.db.pay.miniprogram);
  });
  route('PUT', '/api/admin/pay/miniprogram', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    Object.keys(ctx.body || {}).forEach(function (k) { if (k in db.pay.miniprogram) db.pay.miniprogram[k] = ctx.body[k]; });
    db.pay.miniprogram.configured = !!(db.pay.miniprogram.appId && db.pay.miniprogram.hasAppSecret);
    save(db);
    return ok(db.pay.miniprogram);
  });

  /* ---------- 商户：上传（转 dataURL） ---------- */
  route('POST', '/api/admin/upload', function (ctx) {
    requireStaff(ctx.db, ctx.req);
    var form = ctx.form;
    var file = form && form.get ? form.get('file') : null;
    if (!file) throw httpError(400, '未选择文件');
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var url = String(reader.result);
        resolve(ok({ url: url, absoluteUrl: url }));
      };
      reader.onerror = function () { reject(httpError(400, '图片读取失败')); };
      reader.readAsDataURL(file);
    });
  });

  /* ---------- 平台运营 ---------- */
  route('GET', '/api/platform/overview', function (ctx) {
    requirePlatform(ctx.db, ctx.req);
    var db = ctx.db;
    var tenants = db.platformData.tenants;
    var overview = clone(db.platformData.overview);
    overview.tenants.total = tenants.length;
    overview.tenants.active = tenants.filter(function (t) { return t.status === 'ACTIVE'; }).length;
    return ok(overview);
  });

  route('GET', '/api/platform/tenants', function (ctx) {
    requirePlatform(ctx.db, ctx.req);
    var db = ctx.db;
    var q = ctx.query || {};
    var list = db.platformData.tenants.slice();
    if (q.keyword) {
      var kw = String(q.keyword).toLowerCase();
      list = list.filter(function (t) { return (t.name + t.code).toLowerCase().indexOf(kw) >= 0; });
    }
    var page = Number(q.page || 1), pageSize = Number(q.pageSize || 20);
    return ok({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page: page, pageSize: pageSize });
  });

  route('POST', '/api/platform/tenants', function (ctx) {
    var db = ctx.db;
    requirePlatform(db, ctx.req);
    var b = ctx.body || {};
    var row = {
      id: uid('ten'), code: b.code || uid('t').slice(-8), name: b.name || '新商户',
      contactName: b.contactName || '', contactPhone: b.contactPhone || '', status: 'ACTIVE', plan: b.plan || 'PRO',
      expireAt: b.expireAt || nowIso(), createdAt: nowIso(), storeName: '', openStatus: false,
      orderCount: 0, staffCount: 1, gmv: 0
    };
    db.platformData.tenants.unshift(row);
    save(db);
    return ok(row);
  });

  route('GET', '/api/platform/tenants/:id', function (ctx) {
    requirePlatform(ctx.db, ctx.req);
    var db = ctx.db;
    var row = db.platformData.tenants.find(function (t) { return t.id === ctx.params.id; });
    if (!row) throw httpError(404, '商户不存在');
    var detail = clone(db.platformData.tenantDetail || {});
    if (detail.id === row.id) return ok(detail);
    var synthetic = clone(row);
    synthetic.brand = clone(db.brand);
    synthetic.store = clone(db.store);
    synthetic.staff = [{ id: 'staff-' + row.id, username: row.code, name: row.contactName || '老板', role: 'OWNER', status: 'ACTIVE' }];
    synthetic.paymentConfig = { enabled: false, mockAllowed: true };
    synthetic._count = { orders: row.orderCount || 0, staff: (synthetic.staff || []).length };
    synthetic.stats = { orderCount: row.orderCount || 0, gmv: row.gmv || 0 };
    return ok(synthetic);
  });

  route('PUT', '/api/platform/tenants/:id', function (ctx) {
    var db = ctx.db;
    requirePlatform(db, ctx.req);
    var row = db.platformData.tenants.find(function (t) { return t.id === ctx.params.id; });
    if (!row) throw httpError(404, '商户不存在');
    var b = ctx.body || {};
    ['name', 'contactName', 'contactPhone', 'status', 'plan', 'expireAt', 'remark', 'code'].forEach(function (k) {
      if (b[k] !== undefined) row[k] = b[k];
    });
    var detail = db.platformData.tenantDetail;
    if (detail && detail.id === row.id) {
      ['name', 'contactName', 'contactPhone', 'status', 'plan', 'expireAt', 'remark', 'code'].forEach(function (k) {
        if (b[k] !== undefined) detail[k] = b[k];
      });
    }
    save(db);
    return ok(row);
  });

  route('PUT', '/api/platform/tenants/:id/brand', function (ctx) {
    var db = ctx.db;
    requirePlatform(db, ctx.req);
    var row = db.platformData.tenants.find(function (t) { return t.id === ctx.params.id; });
    if (!row) throw httpError(404, '商户不存在');
    var detail = db.platformData.tenantDetail;
    if (detail && detail.id === row.id) {
      detail.brand = detail.brand || {};
      Object.keys(ctx.body || {}).forEach(function (k) { if (k in detail.brand) detail.brand[k] = ctx.body[k]; });
      if (ctx.body.banners) detail.brand.banners = JSON.stringify(ctx.body.banners);
    }
    save(db);
    return ok(detail && detail.brand);
  });

  route('POST', '/api/platform/tenants/:id/owner-password', function (ctx) {
    requirePlatform(ctx.db, ctx.req);
    return ok({ ok: true });
  });

  /* ---------- 顾客端 ---------- */
  route('POST', '/api/h5/login', function (ctx) {
    var db = ctx.db;
    var b = ctx.body || {};
    var scene = String(b.scene || '');
    var table = db.tables.find(function (t) { return t.sceneCode === scene || t.name === scene; });
    if (!table) throw httpError(404, '桌码无效，请重新扫描桌面上的点单二维码');
    var clientId = b.clientId || 'anon';
    var customer = db.customers.find(function (c) { return c.clientId === clientId; });
    if (!customer) {
      var names = ['小满', '阿哲', '团团', '阿猹', '七月'];
      customer = {
        id: uid('cust'),
        clientId: clientId,
        nickname: names[db.customers.length % names.length],
        phone: '138****' + String(1000 + Math.floor(Math.random() * 8999))
      };
      db.customers.push(customer);
      save(db);
    }
    return ok({
      token: 'mock-h5:' + customer.id,
      channel: 'h5',
      tenant: { id: db.tenant.id, code: db.tenant.code, name: db.tenant.name },
      table: { id: table.id, name: table.name, area: table.area, sceneCode: table.sceneCode },
      customer: { id: customer.id, nickname: customer.nickname, phone: customer.phone }
    });
  });

  route('GET', '/api/client/bootstrap', function (ctx) {
    var db = ctx.db;
    resolveCustomer(db, ctx.req);
    var scene = String(ctx.query.scene || '');
    var table = db.tables.find(function (t) { return t.sceneCode === scene; });
    if (!table) throw httpError(404, '桌码无效，请重新扫描桌面上的点单二维码');
    return ok({
      tenant: db.tenant,
      brand: db.brand,
      store: db.store,
      table: { id: table.id, name: table.name, area: table.area, seats: table.seats, sceneCode: table.sceneCode },
      wechat: { appId: db.pay.miniprogram.appId || '', mock: true },
      serverTime: nowIso()
    });
  });

  route('GET', '/api/client/menu', function (ctx) {
    var db = ctx.db;
    resolveCustomer(db, ctx.req);
    var cats = db.categories.filter(function (c) { return c.status === 'ON'; })
      .sort(function (a, b) { return a.sort - b.sort; });
    return ok(cats.map(function (c) {
      return {
        id: c.id, name: c.name, icon: c.icon, promoLabel: c.promoLabel, promoTitle: c.promoTitle,
        products: db.products.filter(function (p) { return p.categoryId === c.id && p.status === 'ON'; })
          .sort(function (a, b) { return a.sort - b.sort; })
          .map(function (p) {
            return {
              id: p.id, name: p.name, description: p.description, imageUrl: p.imageUrl, price: p.price,
              originalPrice: p.originalPrice, unit: p.unit,
              tags: p.tags ? String(p.tags).split(',').filter(Boolean) : [],
              monthlySales: p.monthlySales, soldOut: p.soldOut,
              stock: p.stockEnabled ? p.stock : null,
              specGroups: p.specGroups || []
            };
          })
      };
    }));
  });

  route('GET', '/api/client/orders', function (ctx) {
    var db = ctx.db;
    var customer = resolveCustomer(db, ctx.req);
    var q = ctx.query || {};
    var page = Number(q.page || 1), pageSize = Number(q.pageSize || 50);
    var list = db.orders.filter(function (o) { return o.customerId === customer.id; })
      .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    return ok({
      list: list.slice((page - 1) * pageSize, page * pageSize).map(serializeOrder),
      total: list.length, page: page, pageSize: pageSize
    });
  });

  route('GET', '/api/client/orders/:id', function (ctx) {
    var db = ctx.db;
    var customer = resolveCustomer(db, ctx.req);
    var order = db.orders.find(function (o) { return o.id === ctx.params.id; });
    if (!order) throw httpError(404, '订单不存在');
    if (order.customerId !== customer.id) throw httpError(403, '无权查看该订单');
    return ok(serializeOrder(order));
  });

  route('POST', '/api/client/orders', function (ctx) {
    var db = ctx.db;
    var customer = resolveCustomer(db, ctx.req);
    var b = ctx.body || {};
    if (!db.store.openStatus) throw httpError(400, '门店已打烊，暂停接单');
    var table = db.tables.find(function (t) { return t.id === b.tableId; }) || db.tables.find(function (t) { return t.sceneCode === b.scene; });
    if (!table) throw httpError(400, '桌位不存在，请重新扫码');
    if (b.idempotencyKey) {
      var existed = db.orders.find(function (o) { return o.idempotencyKey === b.idempotencyKey && o.customerId === customer.id; });
      if (existed) return ok(serializeOrder(existed));
    }
    var priced = priceItems(db, b.items || []);
    var totals = computeTotals(db, priced.itemAmount, b.type || 'DINE_IN');
    var orderId = uid('ord');
    var order = {
      id: orderId,
      orderNo: buildOrderNo(db),
      tenantId: db.tenant.id, storeId: db.store.id,
      tableId: table.id, tableName: table.name,
      type: b.type || 'DINE_IN', status: 'UNPAID', payStatus: 'UNPAID',
      customerId: customer.id, customerName: customer.nickname || customer.phone,
      peopleCount: b.peopleCount || null, remark: b.remark || null,
      receiverName: b.receiverName || null, receiverPhone: b.receiverPhone || null, address: b.address || null,
      deliveryFee: totals.deliveryFee, deliveryEta: (b.type === 'DELIVERY') ? (db.store.deliveryEta || null) : null,
      itemAmount: priced.itemAmount, discountAmount: totals.discountAmount, packingFee: totals.packingFee,
      totalAmount: totals.totalAmount, paidAmount: 0, pickupNo: null, transactionId: null, outTradeNo: null,
      idempotencyKey: b.idempotencyKey || null, payChannel: null,
      acceptAt: null, readyAt: null, completeAt: null, cancelAt: null, cancelReason: null, paidAt: null,
      createdAt: nowIso(), updatedAt: nowIso(),
      items: priced.items.map(function (it) { it.orderId = orderId; return it; }),
      refunds: []
    };
    db.orders.unshift(order);
    (b.items || []).forEach(function (line) {
      var product = db.products.find(function (p) { return p.id === line.productId; });
      if (!product) return;
      product.monthlySales = (product.monthlySales || 0) + line.quantity;
      if (product.stockEnabled) product.stock = Math.max(0, product.stock - line.quantity);
    });
    save(db);
    return ok(serializeOrder(order));
  });

  route('POST', '/api/client/orders/:id/pay', function (ctx) {
    var db = ctx.db;
    var customer = resolveCustomer(db, ctx.req);
    var order = db.orders.find(function (o) { return o.id === ctx.params.id; });
    if (!order) throw httpError(404, '订单不存在');
    if (order.customerId !== customer.id) throw httpError(403, '无权操作该订单');
    if (order.payStatus === 'PAID') throw httpError(400, '订单已支付');
    if (order.status !== 'UNPAID') throw httpError(400, '订单当前状态为「' + ORDER_STATUS_TEXT[order.status] + '」，无法支付');
    var now = nowIso();
    order.payStatus = 'PAID';
    order.payChannel = 'MOCK';
    order.paidAt = now;
    order.paidAmount = order.totalAmount;
    order.pickupNo = db.seq.pickupNo++;
    order.status = 'PREPARING';
    order.acceptAt = now;
    order.updatedAt = now;
    save(db);
    return ok({ mock: true, payParams: null, order: serializeOrder(order) });
  });

  route('POST', '/api/client/orders/:id/cancel', function (ctx) {
    var db = ctx.db;
    var customer = resolveCustomer(db, ctx.req);
    var order = db.orders.find(function (o) { return o.id === ctx.params.id; });
    if (!order) throw httpError(404, '订单不存在');
    if (order.customerId !== customer.id) throw httpError(403, '无权操作该订单');
    if (!canCustomerCancel(order.status)) throw httpError(400, '订单当前状态为「' + ORDER_STATUS_TEXT[order.status] + '」，无法取消');
    var b = ctx.body || {};
    order.status = 'CANCELLED';
    order.cancelAt = nowIso();
    order.cancelReason = b.reason || '顾客取消';
    if (order.payStatus === 'PAID') { order.payStatus = 'REFUNDED'; order.paidAmount = 0; }
    order.updatedAt = nowIso();
    save(db);
    return ok(serializeOrder(order));
  });

  route('POST', '/api/client/orders/:id/remind', function (ctx) {
    var db = ctx.db;
    var customer = resolveCustomer(db, ctx.req);
    var order = db.orders.find(function (o) { return o.id === ctx.params.id; });
    if (!order) throw httpError(404, '订单不存在');
    if (order.customerId !== customer.id) throw httpError(403, '无权操作该订单');
    return ok({ ok: true, message: '已提醒商家尽快出餐' });
  });

  /* ------------------------------ fetch 接管 ------------------------------ */
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  function parseBody(init, input) {
    var body = init && init.body !== undefined ? init.body : (input && input.body);
    if (!body) return Promise.resolve(null);
    if (typeof body === 'string') {
      try { return Promise.resolve(JSON.parse(body)); } catch (e) { return Promise.resolve(null); }
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) return Promise.resolve(null);
    if (body instanceof ArrayBuffer || (typeof Blob !== 'undefined' && body instanceof Blob)) return Promise.resolve(null);
    return Promise.resolve(null);
  }

  function matchRoute(method, path) {
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i];
      if (r.method !== method) continue;
      var m = r.re.exec(path);
      if (!m) continue;
      var params = {};
      r.keys.forEach(function (k, idx) { params[k] = decodeURIComponent(m[idx + 1]); });
      return { handler: r.handler, params: params };
    }
    return null;
  }

  function handleApi(method, url, init) {
    var u = new URL(url, location.href);
    var path = u.pathname;
    var query = {};
    u.searchParams.forEach(function (v, k) { query[k] = v; });
    var matched = matchRoute(method, path);
    if (!matched) return Promise.resolve(fail(404, '接口不存在：' + method + ' ' + path));
    var req = { headers: (init && init.headers) || {}, method: method };
    var db = load();
    var form = null;
    if (init && typeof FormData !== 'undefined' && init.body instanceof FormData) form = init.body;
    return parseBody(init, null).then(function (body) {
      var ctx = { db: db, req: req, body: body, query: query, params: matched.params, form: form };
      var result;
      try {
        result = matched.handler(ctx);
      } catch (err) {
        return fail(err.__status || 500, err.message || '服务异常');
      }
      if (result && typeof result.then === 'function') {
        return result.then(function (res) { return res; }, function (err) { return fail(err.__status || 500, err.message || '服务异常'); });
      }
      return result;
    });
  }

  if (nativeFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var abs;
      try { abs = new URL(url, location.href); } catch (e) { return nativeFetch(input, init); }
      if (abs.origin === location.origin && abs.pathname.indexOf('/api/') === 0) {
        return handleApi(method, url, init);
      }
      return nativeFetch(input, init);
    };
  }

  /* ------------------------------ 跨设备同步（保留安装包实时能力的演示版） ------------------------------ */
  var MQTT_NS = 'dsh-tianshu-order-demo/v5/';
  var TOPIC_STATE = MQTT_NS + 'state';
  var sync = { client: null, connected: false, timer: null };

  function schedulePublish() {
    if (!window.mqtt) return;
    if (sync.timer) clearTimeout(sync.timer);
    sync.timer = setTimeout(publishState, 700);
  }

  function publishState(resetFlag) {
    if (!window.mqtt || !sync.client || !sync.connected) return;
    try {
      var db = load();
      sync.client.publish(TOPIC_STATE, JSON.stringify({ v: 5, ts: Date.now(), reset: !!resetFlag, orders: db.orders }), { qos: 1, retain: true });
    } catch (e) { /* ignore */ }
  }

  function mergeRemoteOrders(remoteOrders) {
    var db = load();
    var index = {};
    db.orders.forEach(function (o) { index[o.id] = o; });
    var changed = false;
    remoteOrders.forEach(function (r) {
      if (!r || !r.id) return;
      var local = index[r.id];
      if (!local) {
        db.orders.push(r);
        index[r.id] = r;
        changed = true;
      } else if (new Date(r.updatedAt || 0).getTime() > new Date(local.updatedAt || 0).getTime()) {
        var idx = db.orders.indexOf(local);
        if (idx >= 0) db.orders[idx] = r;
        index[r.id] = r;
        changed = true;
      }
    });
    if (changed) {
      db.orders.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
      save(db, { publish: false });
    }
    return changed;
  }

  function initSync() {
    if (!window.mqtt || !window.mqtt.connect) return;
    try {
      sync.client = window.mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
        clientId: 't4demo-' + Math.random().toString(16).slice(2, 10),
        reconnectPeriod: 5000,
        connectTimeout: 8000,
        clean: true
      });
      sync.client.on('connect', function () {
        sync.connected = true;
        try { sync.client.subscribe(TOPIC_STATE, { qos: 1 }); } catch (e) { /* ignore */ }
        publishState();
      });
      sync.client.on('close', function () { sync.connected = false; });
      sync.client.on('message', function (topic, payload) {
        var msg;
        try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
        if (!msg || msg.v !== 5 || !Array.isArray(msg.orders)) return;
        if (msg.reset) {
          // 另一端重置了演示数据：本地清库重播种子，让“清空演示单”在跨设备间也生效
          try { localStorage.removeItem(DB_KEY); } catch (e) { /* ignore */ }
          load();
          publishState(false);
          return;
        }
        if (Date.now() - (msg.ts || 0) > 12 * 3600 * 1000) { publishState(); return; }
        if (mergeRemoteOrders(msg.orders)) schedulePublish();
      });
    } catch (e) { /* 无网络时退化为本机模式 */ }
  }

  initSync();
  window.addEventListener('storage', function (ev) { if (ev.key === DB_KEY) schedulePublish(); });

  /* ------------------------------ 调试接口（验收脚本用） ------------------------------ */
  window.__T4 = {
    db: load,
    save: save,
    reset: function () {
      try { localStorage.removeItem(DB_KEY); } catch (e) { /* ignore */ }
      var db = load();
      publishState(true);
      return db;
    },
    syncStatus: function () { return { connected: sync.connected, hasMqtt: !!window.mqtt }; },
    serializeOrder: function (id) {
      var db = load();
      return serializeOrder(db.orders.find(function (o) { return o.id === id; }));
    }
  };

  if (BC) {
    BC.onmessage = function () { /* 各页面靠轮询/再次请求拿到最新数据，这里只做唤醒 */ };
  }
})();
