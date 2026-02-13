const axios = require("axios");
require("dotenv").config();

const {
  SHOPIFY_STORE,
  SHOPIFY_ADMIN_ACCESS_TOKEN,
  SHOPIFY_API_VERSION,
  PALLETFORCE_URL,
  PALLETFORCE_ACCESS_KEY
} = process.env;

// =====================
// SHOPIFY CONNECTION (ADMIN TOKEN)
// =====================
const shopify = axios.create({
  baseURL: `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}`,
  headers: {
    "X-Shopify-Access-Token": SHOPIFY_ADMIN_ACCESS_TOKEN,
    "Content-Type": "application/json"
  }
});

// =====================
// EVENT CODE → TAG MAP
// =====================
const EVENT_TAG_MAP = {
  SCOT: "status_processing",
  ARRH: "status_in_transit",
  DELV: "status_in_transit",
  POD: "status_delivered"
};

const STATUS_TAGS = [
  "status_processing",
  "status_in_transit",
  "status_delivered"
];

// =====================
// GET SHOPIFY ORDERS
// =====================
async function getOrders() {
  const res = await shopify.get(`/orders.json?status=any&limit=50&fields=id,name,tags`);
  return res.data.orders;
}

async function getTrackingFromMetafield(orderId) {
  const res = await shopify.get(
    `/orders/${orderId}/metafields.json`
  );

  const mf = res.data.metafields.find(
    m => m.namespace === "custom" &&
         m.key === "palletforce_tracking"
  );

  return mf?.value || null;
}

// =====================
// PALLETFORCE TRACKING
// =====================
async function getTrackingStatus(trackingNumber) {
  const res = await axios.post(PALLETFORCE_URL, {
    accessKey: PALLETFORCE_ACCESS_KEY,
    trackingNumber
  });
  return res.data.trackingData || [];
}

// ===============================
// SAVE TRACKING TO SHOPIFY
// ===============================


const orderRes = await shopify.get(`/orders/${orderId}.json`);
const existingTracking =
  orderRes.data.order.fulfillments?.some(
    f => f.tracking_number === trackingNumber
  );

if (existingTracking) {
  console.log(`⏭ Order ${orderId}: Tracking already exists`);
  return;
}


async function saveTrackingToShopify(orderId, trackingNumber) {
  const foRes = await shopify.get(
    `/orders/${orderId}/fulfillment_orders.json`
  );

  const fulfillmentOrder = foRes.data.fulfillment_orders?.find(
    fo => fo.status === "open"
  );

  if (!fulfillmentOrder) {
    console.log(`⚠️ Order ${orderId}: No open fulfillment`);
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

  console.log(`✅ Tracking saved → ${trackingNumber}`);
}

// =====================
// UPDATE SHOPIFY TAG
// =====================
async function updateOrderTag(order, newTag) {
  let tags = order.tags ? order.tags.split(", ") : [];
  tags = tags.filter(tag => !STATUS_TAGS.includes(tag));
  tags.push(newTag);

  await shopify.put(`/orders/${order.id}.json`, {
    order: { id: order.id, tags: tags.join(", ") }
  });
}

if (order.tags?.includes(newTag)) {
  console.log(`⏭ Order ${order.id}: Tag already ${newTag}`);
  continue;
}

// =====================
// MAIN RUN
// =====================
async function run() {
  console.log("⏳ Palletforce Shopify sync started");

  const orders = await getOrders();

  for (const order of orders) {

  const palletTracking = await getTrackingFromMetafield(order.id);

  if (!palletTracking) {
    console.log(`⏭ Order ${order.id} — No metafield tracking`);
    continue;
  }

  const trackingData = await getTrackingStatus(palletTracking);

  if (!trackingData.length) {
    console.log(`⏭ Order ${order.id} — No Palletforce data`);
    continue;
  }

  const latestEvent =
    trackingData[trackingData.length - 1];

  const newTag =
    EVENT_TAG_MAP[latestEvent.eventCode];

  if (!newTag) continue;

  await updateOrderTag(order, newTag);

  if (
    newTag === "status_in_transit" ||
    newTag === "status_delivered"
  ) {
    await saveTrackingToShopify(order.id, palletTracking);
  }

  console.log(
    `✔ Order ${order.id} → ${newTag}`
  );
}


  console.log("✅ Sync finished");
}


run().catch(err => {
  console.error("❌ Error:", err.response?.data || err.message);
  process.exit(1);
});
