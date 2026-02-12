const axios = require("axios");
require("dotenv").config();

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





// ===============================
// SAVE TRACKING TO SHOPIFY
// ===============================
async function saveTrackingToShopify(orderId, trackingNumber) {
  const baseUrl = `https://${process.env.SHOPIFY_SHOP}/admin/api/2024-01`;

  const foRes = await axios.get(
    `${baseUrl}/orders/${orderId}/fulfillment_orders.json`,
    {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
      },
    }
  );

  const fulfillmentOrder = foRes.data.fulfillment_orders?.find(
    fo => fo.status === "open"
  );

  if (!fulfillmentOrder) {
    console.log("⚠️ No open fulfillment order — skipping Shopify update");
    return;
  }

  await axios.post(
    `${baseUrl}/fulfillments.json`,
    {
      fulfillment: {
        line_items_by_fulfillment_order: [
          { fulfillment_order_id: fulfillmentOrder.id },
        ],
        tracking_info: {
          number: trackingNumber,
          company: "Palletforce",
          url: `https://www.palletforce.com/track/?tracking=${trackingNumber}`,
        },
        notify_customer: true,
      },
    },
    {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
    }
  );

  console.log("✅ Tracking saved to Shopify:", trackingNumber);
}



// =====================
// UPDATE SHOPIFY TAG
// =====================
async function updateOrderTag(order, newTag) {
  let tags = order.tags ? order.tags.split(", ") : [];

  // Remove existing status tags
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
  console.log("⏳ Palletforce Shopify sync started");

  const orders = await getOrders();

  for (const order of orders) {

    // Skip delivered orders
    if (order.tags?.includes("status_delivered")) continue;

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

    // Add tracking number when order is in transit
// Add tracking when order is in transit OR delivered
// After updating the order tag
if (
  newTag === "status_in_transit" ||
  newTag === "status_delivered"
) {
  await saveTrackingToShopify(order.id, trackingNumber);
}


    console.log(`✔ Order ${order.id} → ${newTag}`);
  }

  console.log("✅ Sync finished");
}

run().catch(err => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
