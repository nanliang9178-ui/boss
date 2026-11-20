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

  function maskSecret(value, keep) {
    keep = keep || 4;
    if (!value) return '';
    if (value.length <= keep * 2) return new Array(value.length + 1).join('*');
    return value.slice(0, keep) + new Array(Math.min(12, value.length - keep * 2) + 1).join('*') + value.slice(-keep);
  }

  function parseBanners(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try { var arr = JSON.parse(value); return Array.isArray(arr) ? arr : []; } catch (e) { return []; }
  }

  function normalizeSpecGroups(groups) {
    var out = [];
    (Array.isArray(groups) ? groups : []).forEach(function (g, gi) {
      var groupName = g.name || ('规格' + (gi + 1));
      var opts = (Array.isArray(g.options) ? g.options : []).map(function (o, oi) {
        return {
          id: o.id || uid('so'),
          name: o.name || ('选项' + (oi + 1)),
          priceDelta: Number(o.priceDelta) || 0,
          defaultSelected: !!o.defaultSelected,
          sort: typeof o.sort === 'number' ? o.sort : oi
        };
      });
      if (!opts.length) throw httpError(400, '规格「' + groupName + '」至少需要一个选项');
      if (!g.multiple && opts.filter(function (o) { return o.defaultSelected; }).length > 1) {
        throw httpError(400, '规格「' + groupName + '」为单选，不能设置多个默认项');
      }
      out.push({
        id: g.id || uid('sg'),
        name: groupName,
        required: !!g.required,
        multiple: !!g.multiple,
        sort: typeof g.sort === 'number' ? g.sort : gi,
        options: opts
      });
    });
    return out;
  }

  function freshSpecGroups(groups) {
    return (Array.isArray(groups) ? groups : []).map(function (g) {
      var gg = clone(g);
      delete gg.id;
      gg.options = (g.options || []).map(function (o) { var oo = clone(o); delete oo.id; return oo; });
      return gg;
    });
  }

  function serializeProduct(db, product) {
    var out = clone(product);
    var cat = db.categories.find(function (c) { return c.id === product.categoryId; });
    out.category = cat ? { id: cat.id, name: cat.name } : (product.category || null);
    out.specGroups = (product.specGroups || []).slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); }).map(function (g) {
      var gg = clone(g);
      gg.options = (g.options || []).slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
      return gg;
    });
    return out;
  }

  function payConfigView(db) {
    var c = db.pay.config;
    return {
      appId: c.appId || '',
      appSecretMasked: c.appSecretMasked || '',
      mchId: c.mchId || '',
      serialNo: c.serialNo || '',
      apiV3KeyMasked: c.apiV3KeyMasked || '',
      privateKeyMasked: c.hasPrivateKey ? '已上传，如需更换请重新上传' : '',
      hasPrivateKey: !!c.hasPrivateKey,
      enabled: !!c.enabled,
      verifiedAt: c.verifiedAt || null,
      statusMsg: c.statusMsg || null,
      notifyUrl: (typeof location !== 'undefined' && location.origin ? location.origin : '') + '/api/pay/notify/' + (db.tenant && db.tenant.code || 'demo'),
      mockAllowed: true,
      ready: !!(c.enabled && c.mchId && c.hasPrivateKey && c.apiV3KeyMasked)
    };
  }

  function miniprogramView(db) {
    var m = db.pay.miniprogram;
    return {
      appId: m.appId || '',
      appSecretMasked: m.appSecretMasked || '',
      hasAppSecret: !!m.hasAppSecret,
      envVersion: m.envVersion || 'release',
      configured: !!(m.appId && m.hasAppSecret),
      homePage: 'pages/menu/index'
    };
  }

  function ensurePlatformBrand(db, row) {
    var map = db.platformData.brands || (db.platformData.brands = {});
    if (map[row.id]) { map[row.id].banners = parseBanners(map[row.id].banners); return map[row.id]; }
    var brand;
    if (row.code === 'demo') {
      brand = clone(db.brand);
    } else if (db.platformData.tenantDetail && db.platformData.tenantDetail.id === row.id) {
      brand = clone(db.platformData.tenantDetail.brand || {});
    } else {
      brand = {
        logoUrl: '', coverUrl: '', primaryColor: '#FF5A1F', accentColor: '#F2B544',
        slogan: '扫码点单，先人一步', announcement: '', servicePhone: row.contactPhone || '',
        copyright: '', banners: []
      };
    }
    brand.tenantId = brand.tenantId || row.id;
    brand.banners = parseBanners(brand.banners);
    map[row.id] = brand;
    return brand;
  }

  function tenantBrandView(db, row) {
    var brand = ensurePlatformBrand(db, row);
    var out = clone(brand);
    out.banners = parseBanners(brand.banners);
    return { tenant: { name: row.name }, brand: out };
  }

  function tenantDetailView(db, row) {
    var brand = ensurePlatformBrand(db, row);
    var detail;
    if (row.code === 'demo') {
      detail = clone(row);
      detail.brand = clone(brand);
      detail.store = clone(db.store);
      detail.staff = db.staff.map(function (s) {
        return { id: s.id, username: s.username, name: s.name, role: s.role, status: 'ACTIVE' };
      });
      detail.paymentConfig = {
        appId: db.pay.miniprogram.appId || '',
        mchId: db.pay.config.mchId || '',
        enabled: !!db.pay.config.enabled,
        verifiedAt: db.pay.config.verifiedAt || null,
        statusMsg: db.pay.config.statusMsg || null,
        mockAllowed: true
      };
      var paid = db.orders.filter(function (o) { return o.payStatus === 'PAID'; });
      var today = dayStart(new Date());
      detail.stats = {
        gmv: paid.reduce(function (s, o) { return s + (o.paidAmount || 0); }, 0),
        orderCount: db.orders.length,
        todayOrders: paid.filter(function (o) { return o.paidAt && new Date(o.paidAt).getTime() >= today; }).length
      };
      detail._count = {
        orders: db.orders.length,
        categories: db.categories.length,
        products: db.products.length,
        tables: db.tables.length
      };
    } else if (db.platformData.tenantDetail && db.platformData.tenantDetail.id === row.id) {
      detail = clone(db.platformData.tenantDetail);
      detail.brand = clone(brand);
      detail.paymentConfig = detail.paymentConfig || { enabled: false, mockAllowed: true };
      detail.stats = detail.stats || { gmv: row.gmv || 0, orderCount: row.orderCount || 0, todayOrders: 0 };
      detail._count = detail._count || {
        orders: row.orderCount || 0,
        categories: (detail.stats && detail.stats.categoryCount) || 0,
        products: 0,
        tables: 0
      };
      detail.staff = detail.staff || [];
    } else {
      detail = clone(row);
      detail.brand = clone(brand);
      detail.store = (db.platformData.extraStores && db.platformData.extraStores[row.id]) || null;
      detail.staff = (db.platformData.extraStaff && db.platformData.extraStaff[row.id]) || [];
      detail.staff = detail.staff.map(function (s) {
        return { id: s.id, username: s.username, name: s.name, role: s.role, status: s.status || 'ACTIVE' };
      });
      detail.paymentConfig = { enabled: false, mockAllowed: true };
      detail.stats = { gmv: row.gmv || 0, orderCount: row.orderCount || 0, todayOrders: 0 };
      detail._count = { orders: row.orderCount || 0, categories: 0, products: 0, tables: 0 };
    }
    return detail;
  }


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
    var used = db.products.filter(function (p) { return p.categoryId === ctx.params.id; }).length;
    if (used > 0) throw httpError(400, '该分类下还有菜品，请先移动或删除菜品');
    db.categories.splice(idx, 1);
    save(db);
    return ok({ success: true });
  });

  /* ---------- 商户：菜品 ---------- */
  route('GET', '/api/admin/menu/products', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var list = db.products.slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
    return ok(list.map(function (p) { return serializeProduct(db, p); }));
  });

  function applyProductBody(db, product, b) {
    var cat = db.categories.find(function (c) { return c.id === b.categoryId; });
    ['name', 'description', 'imageUrl', 'originalPrice', 'unit', 'stockEnabled', 'stock', 'soldOut', 'status', 'sort'].forEach(function (k) {
      if (b[k] !== undefined) product[k] = b[k];
    });
    if (b.price !== undefined) product.price = Number(b.price) || 0;
    if (b.categoryId) product.categoryId = b.categoryId;
    if (Array.isArray(b.tags)) product.tags = b.tags.join(',');
    else if (b.tags !== undefined) product.tags = b.tags;
    if (cat) product.category = { id: cat.id, name: cat.name };
    if (b.specGroups !== undefined) product.specGroups = normalizeSpecGroups(b.specGroups);
    product.updatedAt = nowIso();
    return product;
  }

  route('POST', '/api/admin/menu/products', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var b = ctx.body || {};
    var categoryId = b.categoryId || (db.categories[0] && db.categories[0].id);
    if (!db.categories.find(function (c) { return c.id === categoryId; })) throw httpError(400, '请先选择菜品分类');
    var product = {
      id: uid('prod'), tenantId: db.tenant.id, storeId: db.store.id, categoryId: categoryId,
      name: b.name || '新菜品', description: b.description || '', imageUrl: b.imageUrl || null,
      price: typeof b.price === 'number' ? b.price : 0, originalPrice: b.originalPrice || null, unit: b.unit || '份',
      monthlySales: 0, tags: '', stockEnabled: !!b.stockEnabled, stock: Number(b.stock) || 0, soldOut: !!b.soldOut,
      status: b.status || 'ON', sort: typeof b.sort === 'number' ? b.sort : db.products.length,
      createdAt: nowIso(), updatedAt: nowIso(), specGroups: []
    };
    applyProductBody(db, product, b);
    db.products.push(product);
    save(db);
    return ok(serializeProduct(db, product));
  });

  route('PUT', '/api/admin/menu/products/:id', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var product = db.products.find(function (p) { return p.id === ctx.params.id; });
    if (!product) throw httpError(404, '菜品不存在');
    applyProductBody(db, product, ctx.body || {});
    save(db);
    return ok(serializeProduct(db, product));
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
    copy.name = String(product.name + '（复制）').slice(0, 40);
    copy.status = 'OFF';
    copy.sort = (product.sort || 0) + 1;
    copy.monthlySales = 0;
    copy.specGroups = normalizeSpecGroups(freshSpecGroups(product.specGroups));
    copy.createdAt = nowIso();
    copy.updatedAt = nowIso();
    db.products.push(copy);
    save(db);
    return ok(serializeProduct(db, copy));
  });

  /* ---------- 商户：订单 ---------- */
  function orderMatcher(db, query) {
    var q = query || {};
    var kw = q.keyword ? String(q.keyword).trim().toLowerCase() : '';
    var fromT = q.dateFrom ? dayStart(new Date(q.dateFrom + 'T00:00:00')) : null;
    var toT = q.dateTo ? dayEnd(new Date(q.dateTo + 'T00:00:00')) : null;
    return function (o) {
      if (kw) {
        var hay = (String(o.orderNo) + ' ' + String(o.tableName || '')).toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      if (fromT !== null || toT !== null) {
        var t = new Date(o.createdAt).getTime();
        if (fromT !== null && t < fromT) return false;
        if (toT !== null && t > toT) return false;
      }
      return true;
    };
  }

  route('GET', '/api/admin/orders', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var q = ctx.query || {};
    var page = Math.max(1, Number(q.page || 1));
    var pageSize = Math.max(1, Math.min(200, Number(q.pageSize || 20)));
    var matched = orderMatcher(db, q);
    var base = db.orders.filter(matched);
    var list = base.slice();
    if (q.status && q.status !== 'ALL') list = list.filter(function (o) { return o.status === q.status; });
    list.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    var counts = {};
    base.forEach(function (o) { counts[o.status] = (counts[o.status] || 0) + 1; });
    return ok({
      list: list.slice((page - 1) * pageSize, page * pageSize).map(serializeOrder),
      total: list.length,
      page: page,
      pageSize: pageSize,
      counts: counts
    });
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
    var staff = requireStaff(db, ctx.req);
    var order = db.orders.find(function (o) { return o.id === ctx.params.id; });
    if (!order) throw httpError(404, '订单不存在');
    var action = ctx.params.action;
    var b = ctx.body || {};
    if (action === 'accept') {
      transitionTo(order, 'PREPARING', { acceptAt: nowIso() });
    } else if (action === 'reject') {
      transitionTo(order, 'CANCELLED', {
        cancelAt: nowIso(),
        cancelReason: b.reason || '商家拒单',
        payStatus: order.payStatus === 'PAID' ? 'REFUNDED' : 'CLOSED'
      });
    } else if (action === 'ready') {
      transitionTo(order, 'READY', { readyAt: nowIso() });
    } else if (action === 'undo-ready') {
      if (order.status !== 'READY') throw httpError(400, '仅待取餐的订单可撤销出餐');
      order.status = 'PREPARING';
      order.readyAt = null;
      order.updatedAt = nowIso();
      save(db);
      return ok(serializeOrder(order));
    } else if (action === 'complete') {
      transitionTo(order, 'COMPLETED', { completeAt: nowIso() });
    } else if (action === 'cancel') {
      if (order.status === 'COMPLETED' || order.status === 'CANCELLED') throw httpError(400, '订单已结束，无法取消');
      var cancelReason = b.reason || '商家取消';
      if (order.payStatus === 'PAID') {
        order.payStatus = 'REFUNDED';
        order.status = 'CANCELLED';
        order.cancelAt = nowIso();
        order.cancelReason = cancelReason;
        order.refunds = order.refunds || [];
        order.refunds.push({
          id: uid('rf'),
          orderId: order.id,
          tenantId: order.tenantId,
          refundNo: 'RF' + Date.now(),
          amount: order.paidAmount || order.totalAmount,
          status: 'SUCCESS',
          reason: cancelReason,
          operatorName: staff.name,
          finishedAt: nowIso(),
          createdAt: nowIso()
        });
        order.updatedAt = nowIso();
        save(db);
        return ok({ success: true, refunded: true, order: serializeOrder(order) });
      }
      order.status = 'CANCELLED';
      order.payStatus = 'CLOSED';
      order.cancelAt = nowIso();
      order.cancelReason = cancelReason;
      order.updatedAt = nowIso();
      save(db);
      return ok({ success: true, refunded: false, order: serializeOrder(order) });
    } else if (action === 'refund') {
      if (order.payStatus !== 'PAID') throw httpError(400, '该订单未支付或已退款');
      order.payStatus = 'REFUNDED';
      order.status = 'CANCELLED';
      order.cancelAt = order.cancelAt || nowIso();
      order.cancelReason = b.reason || '商家退款';
      order.updatedAt = nowIso();
    } else if (action === 'append') {
      throw httpError(400, '请通过顾客端加菜接口操作');
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
    var list = db.tables.slice().sort(function (a, b) {
      var areaCmp = String(a.area || '').localeCompare(String(b.area || ''));
      if (areaCmp !== 0) return areaCmp;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    var areas = [];
    list.forEach(function (t) { if (areas.indexOf(t.area) < 0) areas.push(t.area); });
    var mp = db.pay.miniprogram || {};
    return ok({
      total: list.length,
      areas: areas,
      publicBaseUrl: publicBaseUrl(),
      miniprogram: { configured: !!(mp.appId && mp.hasAppSecret), envVersion: mp.envVersion || 'release' },
      list: list.map(function (t) { return serializeTable(db, t); })
    });
  });

  route('POST', '/api/admin/tables', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var b = ctx.body || {};
    var name = String(b.name || ('新桌' + (db.tables.length + 1))).trim();
    if (db.tables.some(function (t) { return t.name === name; })) throw httpError(400, '该桌号已存在');
    var table = {
      id: uid('tbl'), tenantId: db.tenant.id, storeId: db.store.id,
      sceneCode: b.sceneCode || uid('s').slice(-10).toLowerCase(),
      area: b.area || '大厅', name: name, seats: Number(b.seats) || 4,
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
    var count = Math.max(1, Math.min(200, Number(b.count) || 1));
    var start = Math.max(1, Number(b.start) || 1);
    var prefix = String(b.prefix || 'A');
    var names = [];
    for (var i = 0; i < count; i++) names.push(prefix + pad(start + i));
    var duplicated = names.filter(function (n) {
      return db.tables.some(function (t) { return t.name === n; });
    });
    if (duplicated.length) throw httpError(400, '桌号 ' + duplicated.join('、') + ' 已存在');
    var area = b.area || '大厅';
    var seats = Number(b.seats) || 4;
    names.forEach(function (n) {
      db.tables.push({
        id: uid('tbl'), tenantId: db.tenant.id, storeId: db.store.id,
        sceneCode: uid('s').slice(-10).toLowerCase(),
        area: area, name: n, seats: seats, qrCodeUrl: null, createdAt: nowIso()
      });
    });
    save(db);
    return ok({ success: true, created: names.length });
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
    return ok(payConfigView(ctx.db));
  });

  route('PUT', '/api/admin/pay/config', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var b = ctx.body || {};
    var c = db.pay.config;
    if (b.appId !== undefined) c.appId = String(b.appId || '').trim();
    if (b.mchId !== undefined) c.mchId = String(b.mchId || '').trim();
    if (b.serialNo !== undefined) c.serialNo = String(b.serialNo || '').trim();
    if (b.enabled !== undefined) c.enabled = !!b.enabled;
    if (b.appSecret) c.appSecretMasked = maskSecret(String(b.appSecret).trim());
    if (b.apiV3Key !== undefined && String(b.apiV3Key).trim()) {
      var apiV3Key = String(b.apiV3Key).trim();
      if (apiV3Key.length !== 32) throw httpError(400, 'APIv3 密钥必须为 32 位');
      c.apiV3KeyMasked = maskSecret(apiV3Key);
    }
    if (b.privateKey !== undefined && String(b.privateKey).trim()) {
      var pem = String(b.privateKey).trim();
      if (pem.indexOf('BEGIN') < 0 || pem.indexOf('PRIVATE KEY') < 0) {
        throw httpError(400, '商户私钥格式不正确，请上传 apiclient_key.pem 内容');
      }
      c.hasPrivateKey = true;
      c.privateKeyMasked = '已上传，如需更换请重新上传';
    }
    c.ready = !!(c.enabled && c.mchId && c.hasPrivateKey && c.apiV3KeyMasked);
    save(db);
    return ok(payConfigView(db));
  });

  route('POST', '/api/admin/pay/config/test', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var view = payConfigView(db);
    var missing = [
      !view.mchId && '商户号',
      !view.serialNo && '证书序列号',
      !view.hasPrivateKey && '商户私钥',
      !view.apiV3KeyMasked && 'APIv3 密钥',
      !view.appId && 'AppID'
    ].filter(Boolean);
    if (missing.length) throw httpError(400, '请先补全：' + missing.join('、'));
    db.pay.config.verifiedAt = nowIso();
    db.pay.config.statusMsg = '连接正常';
    db.pay.config.enabled = true;
    db.pay.config.ready = true;
    save(db);
    return ok({ success: true, certCount: 3, message: '配置校验通过，可以正常收款' });
  });

  route('GET', '/api/admin/pay/miniprogram', function (ctx) {
    requireStaff(ctx.db, ctx.req);
    return ok(miniprogramView(ctx.db));
  });

  route('PUT', '/api/admin/pay/miniprogram', function (ctx) {
    var db = ctx.db;
    requireStaff(db, ctx.req);
    var b = ctx.body || {};
    var m = db.pay.miniprogram;
    if (b.appId !== undefined) m.appId = String(b.appId || '').trim();
    if (b.envVersion) m.envVersion = b.envVersion;
    if (b.appSecret) {
      var secret = String(b.appSecret).trim();
      if (secret.length < 16) throw httpError(400, 'AppSecret 长度不正确，请从微信公众平台复制完整密钥');
      m.hasAppSecret = true;
      m.appSecretMasked = maskSecret(secret);
    }
    m.configured = !!(m.appId && m.hasAppSecret);
    m.homePage = 'pages/menu/index';
    save(db);
    return ok(miniprogramView(db));
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
    var rows = db.platformData.tenants.slice();
    if (q.status && q.status !== 'ALL') rows = rows.filter(function (t) { return t.status === q.status; });
    if (q.keyword) {
      var kw = String(q.keyword).trim().toLowerCase();
      rows = rows.filter(function (t) {
        return [t.name, t.code, t.contactName, t.contactPhone].some(function (v) {
          return String(v || '').toLowerCase().indexOf(kw) >= 0;
        });
      });
    }
    var page = Math.max(1, Number(q.page || 1));
    var pageSize = Math.max(1, Number(q.pageSize || 20));
    return ok({ list: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page: page, pageSize: pageSize });
  });

  route('POST', '/api/platform/tenants', function (ctx) {
    var db = ctx.db;
    requirePlatform(db, ctx.req);
    var b = ctx.body || {};
    var code = String(b.code || '').trim() || ('t' + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 8)).toLowerCase();
    var ownerUsername = String(b.ownerUsername || '').trim() || String(b.contactPhone || code);
    var ownerPassword = String(b.ownerPassword || '123456');
    var name = String(b.name || '新商户').trim();
    var now = nowIso();
    var expireAt = b.expireAt || new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    var row = {
      id: uid('ten'), code: code, name: name,
      contactName: b.contactName || '', contactPhone: b.contactPhone || '', status: 'ACTIVE', plan: b.plan || 'PRO',
      expireAt: expireAt, createdAt: now, storeName: name + '（总店）', openStatus: true,
      orderCount: 0, staffCount: 1, gmv: 0
    };
    db.platformData.tenants.unshift(row);
    var brands = db.platformData.brands || (db.platformData.brands = {});
    brands[row.id] = {
      tenantId: row.id, logoUrl: '', coverUrl: '', primaryColor: '#FF5A1F', accentColor: '#F2B544',
      slogan: '扫码点单，先人一步', announcement: '', servicePhone: row.contactPhone || '', copyright: '', banners: []
    };
    var extraStaff = db.platformData.extraStaff || (db.platformData.extraStaff = {});
    extraStaff[row.id] = [{
      id: uid('staff'), username: ownerUsername, password: ownerPassword,
      name: row.contactName || '老板', role: 'OWNER', status: 'ACTIVE'
    }];
    var extraStores = db.platformData.extraStores || (db.platformData.extraStores = {});
    extraStores[row.id] = {
      id: uid('store'), tenantId: row.id, name: row.storeName, address: '', phone: row.contactPhone || '',
      businessHours: '10:00-22:00', openStatus: true, autoAccept: false, packingFee: 200, minOrderAmount: 1500,
      deliveryFee: 300, deliveryMinAmount: 2000, deliveryRange: '3 公里内配送', deliveryEta: 35,
      fullReduceThreshold: 0, fullReduceAmount: 0, notice: '', createdAt: now, updatedAt: now
    };
    save(db);
    return ok(Object.assign({}, row, { ownerUsername: ownerUsername, loginCode: row.code }));
  });

  route('GET', '/api/platform/tenants/:id', function (ctx) {
    var db = ctx.db;
    requirePlatform(db, ctx.req);
    var row = db.platformData.tenants.find(function (t) { return t.id === ctx.params.id; });
    if (!row) throw httpError(404, '商户不存在');
    return ok(tenantDetailView(db, row));
  });

  route('GET', '/api/platform/tenants/:id/brand', function (ctx) {
    var db = ctx.db;
    requirePlatform(db, ctx.req);
    var row = db.platformData.tenants.find(function (t) { return t.id === ctx.params.id; });
    if (!row) throw httpError(404, '商户不存在');
    return ok(tenantBrandView(db, row));
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
    var b = ctx.body || {};
    if (b.primaryColor && b.accentColor && b.primaryColor === b.accentColor) {
      throw httpError(400, '主题色与辅助色不能相同');
    }
    var brand = ensurePlatformBrand(db, row);
    ['logoUrl', 'coverUrl', 'primaryColor', 'accentColor', 'slogan', 'announcement', 'servicePhone', 'copyright'].forEach(function (k) {
      if (b[k] !== undefined) brand[k] = b[k];
    });
    if (b.banners !== undefined) brand.banners = Array.isArray(b.banners) ? b.banners : parseBanners(b.banners);
    if (row.code === 'demo') {
      ['logoUrl', 'coverUrl', 'primaryColor', 'accentColor', 'slogan', 'announcement', 'servicePhone', 'copyright'].forEach(function (k) {
        if (b[k] !== undefined) db.brand[k] = b[k];
      });
      if (b.banners !== undefined) db.brand.banners = brand.banners;
    }
    var seedDetail = db.platformData.tenantDetail;
    if (seedDetail && seedDetail.id === row.id) {
      seedDetail.brand = Object.assign({}, clone(seedDetail.brand || {}), clone(brand), { banners: JSON.stringify(parseBanners(brand.banners)) });
    }
    save(db);
    return ok(tenantBrandView(db, row));
  });

  route('POST', '/api/platform/tenants/:id/owner-password', function (ctx) {
    var db = ctx.db;
    requirePlatform(db, ctx.req);
    var row = db.platformData.tenants.find(function (t) { return t.id === ctx.params.id; });
    if (!row) throw httpError(404, '商户不存在');
    var password = String((ctx.body || {}).password || '');
    if (password.length < 6) throw httpError(400, '密码至少 6 位');
    var username = row.code;
    if (row.code === 'demo') {
      var owner = db.staff.find(function (s) { return s.role === 'OWNER'; });
      if (owner) { owner.password = password; username = owner.username; }
    } else if (db.platformData.extraStaff && db.platformData.extraStaff[row.id] && db.platformData.extraStaff[row.id][0]) {
      db.platformData.extraStaff[row.id][0].password = password;
      username = db.platformData.extraStaff[row.id][0].username;
    }
    save(db);
    return ok({ success: true, username: username });
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
