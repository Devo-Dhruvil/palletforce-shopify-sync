const axios = require("axios");
require("dotenv").config();

const {
  SHOPIFY_STORE,
  SHOPIFY_ADMIN_ACCESS_TOKEN,
  SHOPIFY_API_VERSION,
  PALLETFORCE_URL,
  PALLETFORCE_ACCESS_KEY,
  TEST_ORDER_ID
} = process.env;

// =====================
// SHOPIFY CLIENT
// =====================
const shopify = axios.create({
  baseURL: `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}`,
  headers: {
    "X-Shopify-Access-Token": SHOPIFY_ADMIN_ACCESS_TOKEN,
    "Content-Type": "application/json"
  }
});

// =====================
// EVENT → TAG MAP
// =====================
const EVENT_TAG_MAP = {
  SCOT: "status_processing",
  ARRH: "status_in_transit",
  DELV: "status_in_transit",
  POD: "status_delivered"
};

const STATUS_TAGS = Object.values(EVENT_TAG_MAP);

// =====================
// GET ORDERS
// =====================
async function getOrders() {
  const res = await shopify.get(
    `/orders.json?status=any&limit=50&fields=id,tags`
  );
  return res.data.orders;
}

// =====================
// GET TRACKING FROM META
// =====================
async function getTrackingFromMetafield(orderId) {
  const res = await shopify.get(`/orders/${orderId}/metafields.json`);

  const mf = res.data.metafields.find(
    m => m.namespace === "custom" &&
         m.key === "palletforce_tracking"
  );

  return mf?.value || null;
}

// =====================
// PALLETFORCE API
// =====================
async function getTrackingStatus(trackingNumber) {
  const res = await axios.post(PALLETFORCE_URL, {
    accessKey: PALLETFORCE_ACCESS_KEY,
    trackingNumber
  });

  return res.data.trackingData || [];
}

// =====================
// UPDATE TAG
// =====================
async function updateOrderTag(order, newTag) {
  if (order.tags?.includes(newTag)) {
    console.log(`⏭ Tag already ${newTag}`);
    return;
  }

  let tags = order.tags ? order.tags.split(", ") : [];
  tags = tags.filter(t => !STATUS_TAGS.includes(t));
  tags.push(newTag);

  await shopify.put(`/orders/${order.id}.json`, {
    order: { id: order.id, tags: tags.join(", ") }
  });

  console.log(`✅ Tag updated → ${newTag}`);
}

// =====================
// CREATE TRACKING
// =====================
async function saveTrackingToShopify(orderId, trackingNumber) {

  const orderRes = await shopify.get(`/orders/${orderId}.json`);

  if (orderRes.data.order.fulfillments?.length) {
    console.log("⏭ Already fulfilled — skip tracking create");
    return;
  }

  const foRes = await shopify.get(
    `/orders/${orderId}/fulfillment_orders.json`
  );

  const fulfillmentOrder = foRes.data.fulfillment_orders?.find(
    fo => fo.status === "open"
  );

  if (!fulfillmentOrder) {
    console.log("⏭ No open fulfillment order");
    return;
  }

  await shopify.post(`/fulfillments.json`, {
    fulfillment: {
      line_items_by_fulfillment_order: [
        { fulfillment_order_id: fulfillmentOrder.id }
      ],
      tracking_info: {
        number: trackingNumber,
        company: "Palletforce",
        url: `https://www.palletforce.com/track/?tracking=${trackingNumber}`
      },
      notify_customer: true
    }
  });

  console.log("📦 Fulfillment created with tracking");
}

// =====================
// MAIN RUN
// =====================
async function run() {

  console.log("⏳ Palletforce sync started");

  const allOrders = await getOrders();

  const orders = TEST_ORDER_ID
    ? allOrders.filter(o => String(o.id) === String(TEST_ORDER_ID))
    : allOrders;

  for (const order of orders) {

    console.log("🔎 Checking order:", order.id);

    const trackingNumber = await getTrackingFromMetafield(order.id);

    if (!trackingNumber) {
      console.log("⏭ No tracking metafield");
      continue;
    }

    console.log("📦 Tracking:", trackingNumber);

    const trackingData = await getTrackingStatus(trackingNumber);

    if (!trackingData.length) {
      console.log("⏭ No Palletforce data");
      continue;
    }

    const latestEvent = trackingData[trackingData.length - 1];

    console.log("🚚 Event:", latestEvent.eventCode);

    const newTag = EVENT_TAG_MAP[latestEvent.eventCode];

    if (!newTag) {
      console.log("⏭ Unknown event");
      continue;
    }

    await updateOrderTag(order, newTag);

    if (
      newTag === "status_in_transit" ||
      newTag === "status_delivered"
    ) {
      await saveTrackingToShopify(order.id, trackingNumber);
    }

    console.log(`✔ Done → ${order.id}`);
  }

  console.log("✅ Sync finished");
}

run().catch(err => {
  console.error("❌ Error:", err.response?.data || err.message);
  process.exit(1);
});
