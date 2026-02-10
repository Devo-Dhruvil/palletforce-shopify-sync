const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
require("dotenv").config();

const app = express();
app.use(express.json());

const {
  SHOPIFY_STORE,
  SHOPIFY_TOKEN,
  SHOPIFY_API_VERSION,
  PALLETFORCE_URL,
  PALLETFORCE_ACCESS_KEY,
  PORT
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
  SCOT: "Scanned on Trunk",
  DELV: "Scanned on Delivery Vehicle",
  POD: "POD Received"
};

const STATUS_TAGS = Object.values(EVENT_TAG_MAP);

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

  // Remove old Palletforce tags
  tags = tags.filter(tag => !STATUS_TAGS.includes(tag));

  // Add new tag
  tags.push(newTag);

  await shopify.put(`/orders/${order.id}.json`, {
    order: {
      id: order.id,
      tags: tags.join(", ")
    }
  });
}

// =====================
// MAIN PROCESS
// =====================
async function syncOrders() {
  console.log("⏳ Palletforce sync started");

  const orders = await getOrders();

  for (const order of orders) {
    const trackingNumber =
      order.fulfillments?.[0]?.tracking_number;

    if (!trackingNumber) continue;

    const trackingData =
      await getTrackingStatus(trackingNumber);

    if (!trackingData.length) continue;

    const latestEvent =
      trackingData[trackingData.length - 1];

    const newTag =
      EVENT_TAG_MAP[latestEvent.eventCode];

    if (!newTag) continue;

    await updateOrderTag(order, newTag);

    console.log(
      `✔ Order ${order.id} → ${newTag}`
    );
  }
}

// =====================
// RUN EVERY 1 HOUR
// =====================
cron.schedule("0 * * * *", async () => {
  try {
    await syncOrders();
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
});

// =====================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
