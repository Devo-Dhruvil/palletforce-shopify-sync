const axios = require("axios");
require("dotenv").config();

const {
  SHOPIFY_STORE,
  SHOPIFY_ADMIN_ACCESS_TOKEN,
  SHOPIFY_API_VERSION
} = process.env;

const shopify = axios.create({
  baseURL: `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}`,
  headers: {
    "X-Shopify-Access-Token": SHOPIFY_ADMIN_ACCESS_TOKEN,
    "Content-Type": "application/json"
  }
});

const EVENT_TAG_MAP = {
  ARRH: "status_in_transit",
  POD: "status_delivered"
};

const STATUS_TAGS = Object.values(EVENT_TAG_MAP);

// 🔴 CHANGE THIS ORDER ID TO TEST
const TEST_ORDER_ID = "1142";

// 🔴 FAKE PALLETFORCE RESPONSE
const MOCK_TRACKING_DATA = [
  {
    eventCode: "POD",
    trackingNumber: "1210225625512"
  }
];

async function updateOrderTag(order, newTag) {

  let tags = order.tags
    ? order.tags.split(",").map(t => t.trim())
    : [];

  console.log("Raw:", tags);

  // Remove ALL status_* tags completely
  tags = tags.filter(t => !t.toLowerCase().startsWith("status_"));

  // Add new tag
  tags.push(newTag);

  console.log("Final:", tags);

  await shopify.put(`/orders/${order.id}.json`, {
    order: {
      id: order.id,
      tags: tags.join(", ")
    }
  });

  console.log("✅ Tag updated:", newTag);
}

async function saveTracking(orderId, trackingNumber) {

  const foRes = await shopify.get(
    `/orders/${orderId}/fulfillment_orders.json`
  );

  const fulfillmentOrder = foRes.data.fulfillment_orders.find(
    fo => fo.status === "open"
  );

  if (!fulfillmentOrder) {
    console.log("⚠️ No open fulfillment");
    return;
  }

  await shopify.post(`/fulfillments.json`, {
    fulfillment: {
      line_items_by_fulfillment_order: [
        { fulfillment_order_id: fulfillmentOrder.id }
      ],
      tracking_info: {
        number: trackingNumber,
        company: "Palletforce"
      },
      notify_customer: false
    }
  });

  console.log("🚚 Tracking added:", trackingNumber);
}

async function run() {

  console.log("🧪 Manual test running");

 //  const orderRes = await shopify.get(`/orders/${TEST_ORDER_ID}.json`);

const orderRes = await shopify.get(`/orders.json`, {
  params: {
    name: `#${TEST_ORDER_ID}`,
    status: "any"
  }
});

if (!orderRes.data.orders.length) {
  console.log("❌ Order not found");
  return;
}

const order = orderRes.data.orders[0];
  //  const order = orderRes.data.order;

  const latestEvent = MOCK_TRACKING_DATA[0];

  const newTag = EVENT_TAG_MAP[latestEvent.eventCode];

  await updateOrderTag(order, newTag);

  await saveTracking(order.id, latestEvent.trackingNumber);

  console.log("🎉 Test complete");
}

run().catch(err => {
  console.error("❌ Error:", err.response?.data || err.message);
});
