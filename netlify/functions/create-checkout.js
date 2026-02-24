const Stripe = require("stripe");

exports.handler = async function(event) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{
      price: "price_XXXXX", // сюда вставим твой Stripe price id
      quantity: 1
    }],
    success_url: "https://night-wash.com/success",
    cancel_url: "https://night-wash.com/cancel",

    metadata: {
      source: "night-wash",
    },

    subscription_data: {
      metadata: {
        source: "night-wash",
      }
    }
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ url: session.url })
  };
};
