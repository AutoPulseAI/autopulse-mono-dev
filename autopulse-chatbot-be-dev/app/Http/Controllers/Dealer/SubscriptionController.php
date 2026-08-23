<?php
 
namespace App\Http\Controllers\Dealer;
 
use App\Models\dealer;
use App\Models\Plan;
use App\Models\CancellationRequest;
use App\Models\DealerSource;
use App\Models\Transaction;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Session;

use Illuminate\Support\Str;

use App\Http\Traits\ApiResponseTrait;
use Illuminate\Http\Response;
use Validator;
use Illuminate\Validation\Rule;
use Illuminate\Support\Facades\Storage;
use App\Http\Controllers\Controller;

use Carbon\Carbon;
use App\Mail\SubscriptionConfirmation;
use Stripe\StripeClient;
use Stripe\Stripe;
use Stripe\InvoiceItem;
use Stripe\Invoice;
use Stripe\SubscriptionSchedule;
use Stripe\Subscription;
use Stripe\Exception\InvalidRequestException;
use Stripe\Exception\CardException;
use Illuminate\Support\Facades\Mail;


class SubscriptionController extends Controller
{
    use  ApiResponseTrait;
    public function index()
    {
        $plans = Plan::orderBy('price','asc')->get();
        $dealer = auth('dealer')->user();
        $subscription = $dealer->subscription('default');
        $paymentMethod = $dealer->defaultPaymentMethod();
        return view('template.dealers.subscription', compact('plans','subscription','paymentMethod'));
        
    }

    public function billing()
    {
        $user = Auth::guard('dealer')->user();
        $transactions = Transaction::where('dealer_id',$user->id)->orderBy('id','desc')->get();
        $plan = Plan::first();
        return view('template.dealers.billing', compact('user','transactions','plan'));
    }

    public function createSubscription(Request $request)
    {
        $plan = Plan::first(); // Assuming there's only one plan
        $user = Auth::guard('dealer')->user(); // Get the authenticated user
        $stripe = new StripeClient(env('STRIPE_SECRET')); // Initialize Stripe Client

        // Check if the user is already subscribed to the default plan
        if (!$user->subscribed('default')) {

            // If the user has a Stripe customer ID, re-use it
            $customerId = $user->stripe_id; // 'stripe_id' is the default column used by Cashier to store Stripe customer ID

            // Create or reuse Stripe customer in Checkout Session
            $checkoutSession = [
                'payment_method_types' => ['card'], // Include 'card' for payment methods
                'line_items' => [
                    [
                        'price' => $plan->stripe_price_id, // Stripe price ID for the subscription plan
                        'quantity' => 1,
                    ],
                ],
                'allow_promotion_codes' => true,
                'mode' => 'subscription', // Set to subscription mode
                'success_url' => route('dealer.subscription.success') . '?session_id={CHECKOUT_SESSION_ID}', // Success URL with session_id
                'cancel_url' => route('dealer.subscription.cancel'), // Cancel URL
            ];

            if ($customerId) {
                $checkoutSession['customer'] = $customerId;
            } else {
                // If no Stripe customer ID, Stripe will create a new customer
                $customerId = $stripe->customers->create([
                    'email' => $user->email,
                    'name' => $user->name,
                ]);
    
                // Save the new Stripe customer ID to the user model for future use
                $user->stripe_id = $customerId->id;
                $user->save();
    
               
            }
            $checkoutSession['customer'] = $user->stripe_id;
            // Create the Checkout Session
            $checkoutSession = $stripe->checkout->sessions->create($checkoutSession);
    

            // Redirect to the Stripe Checkout page
            return redirect($checkoutSession->url);
        }

        return redirect()->back()->with('error', 'User is already subscribed.');
    }

    public function subscriptionSuccess(Request $request)
    {
        $sessionId = $request->query('session_id'); // Get the session ID from the request

        if ($sessionId) {
            //try {
                // Initialize Stripe client
                $stripe = new StripeClient(env('STRIPE_SECRET'));

                // Retrieve the Stripe Checkout session using the session ID
                $checkoutSession = $stripe->checkout->sessions->retrieve($sessionId);

                // Get the subscription ID from the checkout session
                $subscriptionId = $checkoutSession->subscription;

                // Retrieve subscription details from Stripe
                $subscription = $stripe->subscriptions->retrieve($subscriptionId);

                // Get the authenticated user
                $user = Auth::guard('dealer')->user();
                $store = DealerSource::where('dealer_id',$user->id)->first();
                $invoice = $stripe->invoices->retrieve($subscription->latest_invoice);

                // Check if the subscription already exists in the database
                $existingSubscription = $user->subscriptions()->where('stripe_id', $subscription->id)->first();
                $couponCode = null;
                $couponAmount = 0;
                if ($subscription->discount && $subscription->discount->coupon) {
                    $couponCode = $subscription->discount->coupon->id; // Coupon code
                    // Total discount amount can be accessed from the invoice
                    $couponAmount = $invoice->total_discount_amounts[0]->amount ?? 0; // Coupon discount amount in cents
                }

                // Retrieve total and discount amounts
                $totalAmount = $invoice->amount_paid/100; // Amount paid
                $discountAmount = $invoice->total_discount_amounts[0]->amount ?? 0; // Total discount amount

                if (!$existingSubscription) {
                    // Sync the subscription with Laravel Cashier (no 'name' column needed)
                    $newSubscription = $user->subscriptions()->create([
                        'type' => 'default',
                      
                        'stripe_id' => $subscription->id,
                        'stripe_status' => $subscription->status,
                        'stripe_price' => $subscription->items->data[0]->price->id,
                        'quantity' => $subscription->items->data[0]->quantity ?? 1,
                        'trial_ends_at' => $subscription->trial_end ? Carbon::createFromTimestamp($subscription->trial_end) : null,
                        'ends_at' => null, // Set this if there's a cancellation or end date
                    ]);
    
                    // Sync subscription items
                    foreach ($subscription->items->data as $item) {
                        $newSubscription->items()->create([
                            'stripe_id' => $item->id, // The Stripe subscription item ID
                            'stripe_product' => $item->price->product, // The product ID in Stripe
                            'stripe_price' => $item->price->id, // The price ID from Stripe
                            'quantity' => $item->quantity ?? 1, // The quantity of the item
                        ]);
                    }
    
                    // Save the transaction details in the 'transactions' table
                   $transactions= Transaction::create([
                        'dealer_id' => $user->id, 
                        'store_id' => $store->id,  
                        'subscription_id' => $newSubscription->id, // Local subscription ID
                        'total_amount' => $totalAmount, // Total amount paid
                        'discount_amount' => $discountAmount, // Discount amount
                        'coupon_amount' => $couponAmount, // Coupon discount amount
                        'coupon_code' => $couponCode, // Coupon code
                        'subscription_start_date' => Carbon::createFromTimestamp($subscription->current_period_start),
                        'subscription_end_date' => Carbon::createFromTimestamp($subscription->current_period_end),
                        'invoice_id' => $invoice->id, // Stripe invoice ID
                        'transaction_type' => 1, 
                    ]);
                    $nextPaymentDate = Carbon::createFromTimestamp($subscription->current_period_end);
                    $store->subscription_id = $newSubscription->id;
                    $store->subscription_price = $totalAmount;
                    $store->subscription_plan = 'Monthly';
                    $store->cancelled_at =  $nextPaymentDate; // Set to null for active subscriptions
                    $store->is_subscribed = 1;
                    $store->is_manage_by_admin = 0;
                    $store->save();
    
                    // Optionally, send a subscription confirmation email
                    Mail::to($user->email)->send(new SubscriptionConfirmation($user, $subscription,$store,$transactions));
               
                    // Redirect to a success page
                    return redirect()->route('dealer.chat.index')->with('success', 'Subscription synced successfully.');
                }
           /* } catch (\Exception $e) {
                // Handle Stripe or general errors
                return redirect()->route('dealer.billing')->with('error', 'An error occurred: ' . $e->getMessage());
            }*/
        }

        // If no session ID is found, return an error
        return redirect()->route('dealer.billing')->with('error', 'Unable to verify the subscription.');
    }

   
    
    /*public function cancelSubscription(Request $request)
    {
        $dealer = auth('dealer')->user();

        $subscription = $dealer->subscription('default'); // Assuming 'default' is the name of the subscription

        if ($subscription && !$subscription->canceled()) {
            if($request->cancel =='now')
                $subscription->cancelNow();
            else 
                $subscription->cancelNow(); // Cancel the subscription at the end of the billing period
           // return $this->respondWithSuccess('Your subscription has been canceled and will end at the conclusion of your current billing period.',$data,Response::HTTP_OK);
            return redirect()->back()->with('success', 'Your subscription has been canceled and will end at the conclusion of your current billing period.');
        }
        return redirect()->back()->with('error', 'No active or cancellable subscription found.');
    }*/

    public function createRequest(Request $request)
    {
        $dealer = auth('dealer')->user();
        $data = $request->validate([
            
            'reason' => 'nullable|string|max:1000',
        ]);

        $dealerSource = DealerSource::where('dealer_id', $dealer['id'])->first();
        if (!$dealerSource) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $cancellationRequest = CancellationRequest::create([
            'dealer_source_id' => $dealerSource->id,
            'dealer_id' => $dealer->id,
            'reason' => $data['reason'],
            'status' => 'pending',
        ]);

        return response()->json(['success' => true, 'message' => 'Cancellation request created successfully.']);
    }

    
}
