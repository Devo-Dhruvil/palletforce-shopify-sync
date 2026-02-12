const axios = require("axios");
require("dotenv").config();

// =====================
// TEST MODE CONFIG
// =====================
const TEST_MODE = process.env.TEST_MODE === "true";
const TEST_ORDER_ID = process.env.TEST_ORDER_ID;

// =====================
// ENV VARIABLES
// =====================
const {
  SHOPIFY_STORE,
  SHOPIFY_TOKEN,
  SHOPIFY_API_VERSION,
  PALLETFORCE_URL,
  PALLETFORCE_ACCESS_KEY
} = process.env;

// =====================
// SHOPIFY CONNECTION
// =====================
const shopify = axios.create({
  baseURL: `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}`,
  headers: {
    "X-Shopify-Access-Token": SHOPIFY_TOKEN,
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
// TEST EVENTS (SIMULATION)
// =====================
 function getNextTestEvent(order) {
  const tags = order.tags ? order.tags.split(", ") : [];

  if (tags.includes("status_processing")) return "SCOT";
  if (tags.includes("status_in_transit")) return "POD";

  // First run (no status tag yet)
  return "ARRH";
}


// =====================
// GET SHOPIFY ORDERS
// =====================
async function getOrders() {
  const res = await shopify.get(`/orders.json?status=any&limit=50`);
  return res.data.orders;
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

// =====================
// UPDATE SHOPIFY TAG
// =====================
async function updateOrderTag(order, newTag) {
  let tags = order.tags ? order.tags.split(", ") : [];

  // Remove existing status_* tags
  tags = tags.filter(tag => !STATUS_TAGS.includes(tag));

  // Add new status tag
  tags.push(newTag);

  await shopify.put(`/orders/${order.id}.json`, {
    order: {
      id: order.id,
      tags: tags.join(", ")
    }
  });
}

// =====================
// MAIN RUN (ONCE)
// =====================
async function run() {
  console.log("⏳ GitHub Action started");
  console.log("🧪 TEST MODE:", TEST_MODE);

  const orders = await getOrders();

  for (const order of orders) {

    // TEST MODE → only one order
    if (TEST_MODE && order.id.toString() !== TEST_ORDER_ID) {
      continue;
    }

    // Skip delivered orders
    if (order.tags?.includes("status_delivered")) continue;

    const trackingNumber =
      order.fulfillments?.[0]?.tracking_number;

    if (!trackingNumber && !TEST_MODE) continue;

    let latestEvent;

    // =====================
    // TEST MODE (NO PALLETFORCE)
    // =====================
 if (TEST_MODE) {
  const nextEvent = getNextTestEvent(order);

  latestEvent = { eventCode: nextEvent };

  console.log(
    `🧪 TEST MODE → Order ${order.id}, simulated event: ${nextEvent}`
  );
}
 else {
      // =====================
      // REAL PALLETFORCE MODE
      // =====================
      const trackingData =
        await getTrackingStatus(trackingNumber);

      if (!trackingData.length) continue;

      latestEvent =
        trackingData[trackingData.length - 1];
    }

    const newTag =
      EVENT_TAG_MAP[latestEvent.eventCode];

    if (!newTag) continue;

    await updateOrderTag(order, newTag);

    console.log(`✔ Order ${order.id} → ${newTag}`);
  }

  console.log("✅ Sync finished");
}

// =====================
run().catch(err => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
