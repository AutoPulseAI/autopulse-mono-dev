<?php
 
namespace App\Http\Controllers\Dealer;
 
use App\Models\dealer;

use App\Models\DealerSource;

use App\Models\Transaction;
use App\Models\CancellationRequest;
use Spatie\Permission\Models\Role;
use App\Models\Visit;
use App\Models\Plan;
use Illuminate\View\View;
use App\Models\Lead;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Session;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Log;
use App\Http\Traits\ApiResponseTrait;
use  Illuminate\Http\Response;
use Validator;
use Illuminate\Validation\Rule;

use App\Http\Controllers\Controller;

use App\Services\SubscriptionService;
use Stripe\Stripe;
use Stripe\Subscription as StripeSubscription;
use Laravel\Cashier\Subscription;
use Barryvdh\DomPDF\Facade\Pdf as PDF;
use App\Mail\SubscriptionInvoice;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use App\Services\MarketcheckApiClient;

class StoreController extends Controller
{
    use ApiResponseTrait;
    /**
     * Display the dashboard for the authenticated user.
     *
     * @return \Illuminate\Contracts\View\View
     */

    protected $subscriptionService;

    public function __construct(SubscriptionService $subscriptionService,MarketcheckApiClient $marketcheckApiClient)
    {
        $this->subscriptionService = $subscriptionService;
        $this->marketcheckApiClient = $marketcheckApiClient;
    }
    


    /**
     * Display the  for the Edit Role user.
     *
     * @return \Illuminate\Contracts\View\View
    */
    public function index(Request $request): View
    {
        $parentId = app('parentId');
        $dealer = Auth::guard('dealer')->user();
        $mainDealer = app('mainDealer');
        $storeList = app('storeList');
        //$dealer->source = 'willmarcars.com';
        $stores =  $storeList;
        return view('template.dealers.store',compact('dealer','stores'));
    }

     /**
     * update the add role 
     *
     * @return \Illuminate\Contracts\View\View
    */

    public function saveStore(Request $request)
    {
        $parentId = app('parentId');
        $dealer = Auth::guard('dealer')->user();
        $data = $request->all();
        $dealerId = $dealer->id;

        $validator = Validator::make($data, [
            'dealership_name.*' => 'required|string|max:255',
            'source.*' => [
                'required',
                'string',
                function($attribute, $value, $fail) use ($parentId) {
                    // Remove https://, http://, www., https://www., or http://www. from source
                    $value = preg_replace('/^(https?:\/\/)?(www\.)?/', '', $value);

                    $params = ['rows'=>0,'start'=>0,'source'=>$value];
                    try {
                        $vehiclelist = $this->marketcheckApiClient->getDealerSource($params);
                        if ($vehiclelist['num_found'] == 0) {
                            $fail('No Vehicle available for this ' . $value);
                        }
                    } catch (\Exception $e) {
                        $fail('The source ' . $value . ' is not valid.');
                    }

                    if (DealerSource::where('dealer_id', '!=', 0)->where('source', strtolower($value))->exists()) {
                        $fail('The source ' . $value . ' has already been taken.');
                    }
                }
            ],
            'adf_email.*' => 'required|email|max:255',
            'email.*' => 'required|email|max:255',
            'phone.*' => 'required|max:10',
            'subscribed.*' => 'required|in:1,0',
            'address.*' => 'required|string|max:255',
            'zip_code.*' => 'required|string|max:10',
            'city.*' => 'required|string|max:255',
        ]);

        if ($validator->fails()) {
            $errors = $validator->errors();
            return $this->respondWithError('Validation Message', $errors, Response::HTTP_OK); 
        }

        $allstore = [];
        foreach ($data['dealership_name'] as $key => $value) {
            // Remove https://, http://, www., https://www., or http://www. from source
            $store = preg_replace('/^(https?:\/\/)?(www\.)?/', '', strtolower($data['source'][$key]));

            $source = DealerSource::where('dealer_id', 0)->where('source', $store)->first();
            if (!$source) {
                $source = DealerSource::create([
                    'dealer_id' => $parentId,
                    'dealership_name' => $data['dealership_name'][$key],
                    'email'=> $data['email'][$key],
                    'phone'=> $data['phone'][$key],
                    'source' => $store,
                    'adf_mail' => $data['adf_email'][$key],
                    'subscribed' => $data['subscribed'][$key],
                    'address' => $data['address'][$key],
                    'zip_code' => $data['zip_code'][$key],
                    'city' => $data['city'][$key],
                    'latitude' => $data['latitude'][$key] ?? null,
                    'longitude' => $data['longitude'][$key] ?? null,
                    'call_tracking_number'=> $data['call_tracking_number'][$key] ?? null,
                    'call_track_sms'=> $data['call_track_sms'][$key] ?? null,
                ]);
            } else {
                $source->update([
                    'dealer_id' => $parentId,
                    'dealership_name' => $data['dealership_name'][$key],
                    'email'=> $data['email'][$key],
                    'phone'=> $data['phone'][$key],
                    'source' => $store,
                    'adf_mail' => $data['adf_email'][$key],
                    'subscribed' => $data['subscribed'][$key],
                    'address' => $data['address'][$key],
                    'zip_code' => $data['zip_code'][$key],
                    'city' => $data['city'][$key],
                    'state' => $data['state'][$key],
                    'latitude' => $data['latitude'][$key] ?? null,
                    'longitude' => $data['longitude'][$key] ?? null,
                    'call_tracking_number'=> $data['call_tracking_number'] ?? null,
                    'call_track_sms'=> $data['call_track_sms'][$key] ?? null,
                ]);
                $lead = Lead::where('dealer_source', $source->source)->first();
                $visit = Visit::where('source', $source->source)->first();
                if ($lead) {
                    Lead::where('dealer_source', $source->source)->update(['store_id'=> $store_id, 'dealer_id' => $data['dealer_id'][$index]]);
                }
                if ($visit) {
                    Visit::where('source', $source->source)->update(['store_id'=> $store_id, 'dealer_id' => $data['dealer_id'][$index]]);
                }
            }

            if ($data['subscribed'][$key] == 1) {
                $allstore[] = $source->id;
            }
        }

        return $this->respondWithSuccess('Source registered successfully.', $allstore, Response::HTTP_OK);
    }

    
    public function updateStore(Request $request)
    {
        $dealerId = Auth::guard('dealer')->id();
        $data = $request->all();
        $parentId = app('parentId');
        $validator = Validator::make($data, [
            'id' => 'required|exists:dealer_source,id',
            'dealership_name' => 'required|string|max:255',
            
            'email' => 'required|email|max:255',
            'phone' => 'required|max:10',
            'adf_email' => 'required|email|max:255',
            'subscribed' => 'required|in:1,0',
            'address' => 'required|string|max:255',
            'zip_code' => 'required|string|max:10',
            'city' => 'required|string|max:255',
            
        ]);
    
        if ($validator->fails()) {
            return response()->json(['success' => false, 'errors' => $validator->errors()], 422);
        }
    
        $store = DealerSource::find($data['id']);
        $allstore = '';
        $store->update([
            'dealership_name' => $data['dealership_name'],
            'email'=> $data['email'],
            'phone'=> $data['phone'],
            'adf_mail' => $data['adf_email'],
            'subscribed' => $data['subscribed'],
            'address' => $data['address'],
            'zip_code' => $data['zip_code'],
            'city' => $data['city'],
            'state' => $data['state'],
            'latitude' => $data['latitude'],
            'longitude' => $data['longitude'],
            'call_tracking_number'=> $data['call_tracking_number'],
            'call_track_sms'=> $data['call_track_sms'],
        ]);
        if(($data['subscribed']==1) &&  ($store->is_subscribed ==0)){
          $allstore = $store->id;
          return $this->respondWithSuccess('Source updated successfully.', [$allstore], Response::HTTP_OK);
        }
        return $this->respondWithSuccess('Source updated successfully.', [], Response::HTTP_OK);
       
    }

    public function cartPopup(Request $request)
    {
        $parentId = app('parentId');
        $dealer = Auth::guard('dealer')->user();
        $plans = $this->subscriptionService->getAvailablePlans();
        $planId = $request->plan_id ?? 1;
        $coupons = $request->coupons ?? [];
        $storeIds = $request->storelist ?? [];
        $couponCodes = []; // To store coupon codes for the next request
        //$request->plan_id =   $planId;
        $stores = DealerSource::whereIn('id', $storeIds)->get();
        if ($stores->isEmpty()) {
            $stores = DealerSource::where([
                'dealer_id' => $parentId,
                'subscribed' => 1,
                'is_manage_by_admin' => 0,
                'is_subscribed' => 0
            ])->get();
        }

        foreach ($stores as $store) {
            $storeIds[] = $store->id;
            $store->subscribed = 1;
            $store->save();
            $store->actual_price = $plans->find($planId)->price;
            $store->subscription_price = $plans->find($planId)->price;

            if (isset($coupons[$store->id])) {
                $couponDetails = $this->subscriptionService->getCouponDetails($coupons[$store->id]);
                $coupons[$store->id] = [
                    'code' => $coupons[$store->id],
                    'valid' => $couponDetails && $couponDetails['valid']
                ];
                if ($couponDetails && $couponDetails['valid']) {
                    $couponCodes[$store->id] = $couponDetails['ID'];
                    if ($couponDetails['amount_off'] > 0) {
                        $store->subscription_price -= $couponDetails['amount_off'] / 100; // Stripe returns amount_off in cents
                    } elseif ($couponDetails['percent_off'] > 0) {
                        $store->subscription_price *= (1 - $couponDetails['percent_off'] / 100);
                    }
                }
            }
        }

        $otherStores = DealerSource::where([
            'dealer_id' => $parentId,
            'is_manage_by_admin' => 0,
            'is_subscribed' => 0
        ])->whereNotIn('id', $storeIds)->get();

        $totalAmount = $stores->sum('subscription_price');

        $cartData = $request->all();
        $cartData['totalAmount'] = $totalAmount;
        $cartData['plan_id'] =$planId; 
        $cartData['coupons'] = $coupons;
        $cartData['coupon_codes'] = $couponCodes; // Add coupon codes to cart data
        session(['cart_data' => $cartData]);

        if ($request->ajax()) {
            return response()->json([
                'html' => view('template.dealers.cart', compact('dealer', 'stores', 'plans', 'totalAmount', 'otherStores', 'planId', 'coupons'))->render()
            ]);
        }

        return view('template.dealers.cart', compact('dealer', 'stores', 'plans', 'totalAmount', 'otherStores', 'planId', 'coupons'));
    }


    public function saveCart(Request $request)
    {
        $cartData = $request->all();
        session(['cart_data' => $cartData]);
        return response()->json(['success' => true]);
    }



    public function applyCoupon(Request $request)
    {
        $parentId = app('parentId');
        $couponCode = $request->input('coupon');
        $storeId = $request->input('store_id');
        $isValid = $this->subscriptionService->applyCoupon($couponCode);

        if ($isValid) {
            // Assume a 10% discount for simplicity
            $store = DealerSource::find($storeId);
            $store->subscription_price = $store->subscription_price * 0.9;
            $store->save();

            $totalAmount = DealerSource::where('dealer_id', Auth::id())->sum('subscription_price');

            return response()->json([
                'message' => 'Coupon applied successfully!',
                'status' => 'success',
                'store' => $store,
                'totalAmount' => $totalAmount
            ]);
        } else {
            return response()->json(['message' => 'Invalid coupon code!', 'status' => 'error']);
        }
    }

    public function moveToCart(Request $request)
    {
        $storeId = $request->input('store_id');
        $dealer = Auth::guard('dealer')->user();

        $store = DealerSource::where('id', $storeId)
            ->where('dealer_id', $dealer->id)
            ->first();

        if ($store) {
            $store->is_subscribed = 1;
            $store->save();

            $totalAmount = DealerSource::where('dealer_id', $dealer->id)
                ->where('is_subscribed', 1)
                ->sum('subscription_price');

            return response()->json([
                'message' => 'Store moved to cart successfully!',
                'status' => 'success',
                'store' => $store,
                'totalAmount' => $totalAmount
            ]);
        } else {
            return response()->json(['message' => 'Store not found!', 'status' => 'error']);
        }
    }

    public function addPaymentMethod(Request $request)
    {
        $parentId = app('parentId');
        $dealer = auth('dealer')->user();
        $cartData = session('cart_data');
       
        if($cartData){
            $paymentMethod = $dealer->defaultPaymentMethod();
            if($request->paymentmethod && $paymentMethod){
                return view('template.dealers.payment', compact('cartData','paymentMethod'));
            }
            return view('template.dealers.payment', compact('cartData','paymentMethod'));
        }else{

        }
        return view('template.dealers.payment');
    }

    public function processPayment(Request $request)
    {
        $parentId = app('parentId');
        $cartData = session('cart_data');
        $paymentMethodId = $request->input('token');
        $dealer = Dealer::where('id', $parentId)->first();

        Stripe::setApiKey(env('STRIPE_SECRET'));

        try {
            $planId = $cartData['plan_id'];
            $plan = Plan::find($planId);
            $totalAmount = 0;
            $discountAmount = 0;
            $couponAmount = 0;
            $purchasedStores = [];

            // Create a customer if it doesn't exist
            $dealer->createOrGetStripeCustomer();
            $dealer->updateDefaultPaymentMethod($paymentMethodId);
            //dd($cartData);
            foreach ($cartData['storelist'] as $storeId) {
                $store = DealerSource::find($storeId);
                $couponCode = $cartData['coupon_codes'][$storeId] ?? null;
                $couponCodeused = $cartData['coupons'][$storeId]['code'] ?? null;
               // dd( $couponCodeused );
                $subscriptionOptions = [
                    'coupon' => $couponCode,
                ];

                $subscription = $dealer->newSubscription("store_{$store->id}", $plan->stripe_price_id)
                ->withCoupon($couponCode)->create($paymentMethodId);

                $invoice = $subscription->latestInvoice();

                $storeTotal = $plan->price;
                $storeDiscount = 0;
                if ($couponCode) {
                    $couponDetails = $this->subscriptionService->getCouponDetails($couponCodeused);
                    if ($couponDetails && $couponDetails['valid']) {
                        if ($couponDetails['amount_off'] > 0) {
                            $storeDiscount = $couponDetails['amount_off'] / 100;
                            $storeTotal -= $storeDiscount;
                        } elseif ($couponDetails['percent_off'] > 0) {
                            $storeDiscount = $plan->price * ($couponDetails['percent_off'] / 100);
                            $storeTotal -= $storeDiscount;
                        }
                        $couponAmount = $storeDiscount;
                    }
                }

                $totalAmount += $storeTotal;
                $discountAmount += $storeDiscount;

                $nextPaymentDate = $this->calculateNextPaymentDate($plan->interval);
                $currentDate = now();

                Transaction::create([
                    'dealer_id' => $parentId,
                    'store_id' => $store->id,
                    'subscription_id' => $subscription->id,
                    'total_amount' => $plan->price,
                    'discount_amount' => $storeDiscount,
                    'coupon_amount' => $couponAmount,
                    'coupon_code' => $couponCodeused,
                    'subscription_start_date' => $currentDate,
                    'transaction_type' => 0,
                    'subscription_end_date' => $nextPaymentDate,
                    'invoice_id' => $invoice ? $invoice->id : null,
                ]);

                $store->subscription_id = $subscription->id;
                $store->subscription_price = $plan->price;
                $store->subscription_plan = $plan->name;
                $store->cancelled_at = $nextPaymentDate;
                $store->is_subscribed = 1;
                $store->save();

                $purchasedStores[] = [
                    'dealership_name' => $store->dealership_name,
                    'subscription_price' => $plan->price,
                    'coupon_code' => $couponCodeused,
                    'discount_amount' => $storeDiscount,
                    'final_price' => $storeTotal,
                ];
                $lead = Lead::where('store_id', $store->id)->first();
              
                if ($lead) {
                    Lead::where('store_id', $store->id)->update(['viewed'=> 1]);
                }
            }

            $this->sendCombinedInvoice($dealer, $totalAmount, $discountAmount, $couponAmount, $purchasedStores);

            return response()->json(['success' => true]);
        } catch (\Exception $e) {
            Log::error('Error message: ' . $e->getMessage());
            Log::error('Error trace: ' . $e->getTraceAsString());

            return response()->json(['success' => false, 'message' => $e->getMessage()]);
        }
    }


    
    private function calculateNextPaymentDate($interval)
    {
        $nextPaymentDate = null;
        switch ($interval) {
            case 'month':
                $nextPaymentDate = now()->addMonth();
                break;
            case 'year':
                $nextPaymentDate = now()->addYear();
                break;
            // Add more cases if there are different intervals
            default:
                $nextPaymentDate = now();
                break;
        }
        return $nextPaymentDate;
    }
    
    
    private function sendCombinedInvoice($dealer, $totalAmount, $discountAmount, $couponAmount, $purchasedStores)
    {
        $finalAmount = $totalAmount - $discountAmount;

        $pdf = PDF::loadView('template.dealers.invoice', compact('dealer', 'totalAmount', 'discountAmount', 'couponAmount', 'purchasedStores', 'finalAmount'));

        $pdfFileName = 'invoice_' . now()->timestamp . '.pdf';
        $pdfFilePath = 'public/invoices/' . $pdfFileName;
        Storage::put($pdfFilePath, $pdf->output());

        $fullPath = Storage::path($pdfFilePath);
        Mail::to($dealer->email)->send(new SubscriptionInvoice($dealer, $totalAmount, $discountAmount, $couponAmount, $purchasedStores,$fullPath));
    }

    public function createRequest(Request $request)
    {
        $parentId = app('parentId');
        $data = $request->validate([
            'store_id' => 'required|exists:dealer_source,id',
            'reason' => 'nullable|string|max:1000',
        ]);

        $dealerSource = DealerSource::where('id', $data['store_id'])->first();
        if (!$dealerSource) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $cancellationRequest = CancellationRequest::create([
            'dealer_source_id' => $dealerSource->id,
            'dealer_id' => $parentId,
            'reason' => $data['reason'],
            'status' => 'pending',
        ]);

        return response()->json(['success' => true, 'message' => 'Cancellation request created successfully.']);
    }
}

