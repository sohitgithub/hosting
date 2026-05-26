import { handleStripeWebhook } from '../services/stripeService.js';

export const stripeWebhook = async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return res.status(400).send('Missing stripe-signature header');
    }
    const result = await handleStripeWebhook(req.body, signature);
    res.json(result);
  } catch (err) {
    console.error('[stripe] webhook error:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
};
