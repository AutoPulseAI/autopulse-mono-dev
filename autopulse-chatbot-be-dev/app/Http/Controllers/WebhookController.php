<?php

namespace App\Http\Controllers;

use App\Models\Dealer;
use App\Models\DealerSource;
use App\Models\Transaction;
use Illuminate\Http\Request;
use Stripe\StripeClient;
use Illuminate\Support\Facades\Log;

class WebhookController extends Controller
{
    public function handleWebhook(Request $request)
    {
        // Retrieve the event by verifying the Stripe signature
        $payload = $request->getContent();
        $sigHeader = $request->header('Stripe-Signature');

        try {
            // Verify the webhook signature using Stripe's Webhook class
            $event = \Stripe\Webhook::constructEvent(
                $payload, $sigHeader, env('STRIPE_WEBHOOK_SECRET')
            );
            Log::info('Webhook received: ' . json_encode($event));
        } catch (\UnexpectedValueException $e) {
            // Invalid payload
            return response('Invalid payload', 400);
        } catch (\Stripe\Exception\SignatureVerificationException $e) {
            // Invalid signature
            return response('Invalid signature', 400);
        }

        // Handle the event
        switch ($event->type) {
            case 'invoice.payment_succeeded':
                $this->handlePaymentSucceeded($event->data->object); // The invoice object
                break;

            case 'invoice.payment_failed':
                $this->handlePaymentFailed($event->data->object); // The invoice object
                break;

            case 'checkout.session.completed':
                $this->handleCheckoutSessionCompleted($event->data->object); // The session object
                break;

            case 'customer.subscription.deleted':
                $this->handleSubscriptionCancelled($event->data->object); // The subscription object
                break;

            default:
                Log::info('Received unknown event type: ' . $event->type);
        }

        return response('Webhook handled', 200);
    }

   // Handle successful payments
   protected function handlePaymentSucceeded($invoice)
   {
       // Retrieve the Stripe customer ID from the invoice
       $stripeCustomerId = $invoice->customer;
       Log::info('Processing payment for invoice: ' . $invoice->id);
       // Find the user based on their Stripe customer ID
       $user = Dealer::where('stripe_id', $stripeCustomerId)->first();

       if ($user) {
           // Save transaction details
           Transaction::create([
               'dealer_id' => $user->id,
               'store_id' => $user->id,
               'stripe_invoice_id' => $invoice->id,
               'status' => 'success',
               'total_amount' => $invoice->amount_paid,
               'coupon_code' => $invoice->discount ? $invoice->discount->coupon->id : null,
               'paid_at' => now(),
               'transaction_type' => 1, // Assuming it's for subscriptions
           ]);

           // You can send an email to the user confirming the payment (optional)
           // Mail::to($user->email)->send(new PaymentSuccessNotification($user));
       }
   }

   // Handle failed payments
   protected function handlePaymentFailed($invoice)
   {
       // Retrieve the Stripe customer ID from the invoice
       $stripeCustomerId = $invoice->customer;
       $stripeSubscriptionId = $invoice->subscription ?? null;

       // Find the user based on their Stripe customer ID
       $user = Dealer::where('stripe_id', $stripeCustomerId)->first();

       if ($user && $stripeSubscriptionId) {
           // Match the exact Stripe subscription this invoice belongs to, not just
           // the most recently created 'default' row — a dealer can have several
           // subscription rows (multi-store, or a cancel+resubscribe history).
           $userSubscription = $user->subscriptions()->where('stripe_id', $stripeSubscriptionId)->first();

           if ($userSubscription) {
               // Mark the subscription as past due
               $userSubscription->update([
                   'stripe_status' => 'past_due',
               ]);
           }
       }
   }

   protected function handleSubscriptionCancelled($subscription)
    {
        // Retrieve the Stripe customer ID from the subscription object
        $stripeCustomerId = $subscription->customer;

        // Find the user based on their Stripe customer ID
        $user = Dealer::where('stripe_id', $stripeCustomerId)->first();

        if ($user) {
            // Match the exact Stripe subscription that was cancelled, not just
            // the most recently created 'default' row — otherwise a cancellation
            // for one subscription can end up marking a different (e.g. newer,
            // or a different store's) local subscription as cancelled.
            $userSubscription = $user->subscriptions()->where('stripe_id', $subscription->id)->first();

            if ($userSubscription) {
                // Mark the subscription as canceled
                $userSubscription->update([
                    'stripe_status' => 'canceled',
                    'ends_at' => now(), // Set the cancellation date
                ]);

                // Update the specific store this subscription belongs to (linked via
                // subscription_id), not an arbitrary store of the dealer's.
                $store = DealerSource::where('subscription_id', $userSubscription->id)->first();
                if ($store) {
                    $store->update([
                        'cancelled_at' => now(),
                        'is_subscribed' => 0,
                    ]);
                } else {
                    Log::warning('handleSubscriptionCancelled: no dealer_source row linked to cancelled subscription', [
                        'dealer_id' => $user->id,
                        'subscription_id' => $userSubscription->id,
                        'stripe_id' => $subscription->id,
                    ]);
                }
            }
        }
    }
}
