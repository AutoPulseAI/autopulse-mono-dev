<?php

namespace App\Http\Controllers\Admin;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Validator;
use Illuminate\Http\Response;
use App\Http\Traits\ApiResponseTrait;
use Illuminate\Support\Facades\DB;
use App\Models\DealerSource;
use App\Models\Dealer;
use App\Models\CancellationRequest;
use App\Models\Lead;
use App\Models\Visit;
use App\Services\SubscriptionService;
use Laravel\Cashier\Subscription;
use Stripe\Stripe;
use Stripe\Subscription as StripeSubscription;
use GuzzleHttp\Client;
use App\Services\MarketcheckApiClient;

class AdminStoreController extends Controller
{
    use ApiResponseTrait;
    protected $marketcheckApiClient;

    public function __construct(MarketcheckApiClient $marketcheckApiClient)
    {
        $this->marketcheckApiClient = $marketcheckApiClient;
    }
    public function index(Request $request)
    {
        $admin= Auth::guard('admin')->user();

        if ($admin->hasPermissionTo('manage stores')) {
            $dealerIds = $admin->managedDealers()->pluck('dealer_id')->toArray();
            // If the user has permission, retrieve the dealer IDs they can manage
            if( $dealerIds)
                $dealerGroup = Dealer::where('parent_id', 0)->where('dealership_group','!=' ,NULL)->whereIn('id', $dealerIds)->get();
            else
                $dealerGroup = Dealer::where('parent_id', 0)->where('dealership_group','!=' ,NULL)->get();
            
        } else {
            $dealerGroup = Dealer::where('parent_id', 0)->where('dealership_group','!=' ,NULL)->get();
        }
       
        return view('template.admin.store.index', compact('dealerGroup'));
    }

    public function storeTableData(Request $request)
    {
        $input = $request->all();
        $request->merge(['page' => (($request->input('start')/ $request->input('length'))+1)]);
        $request->merge(['perPage' => $request->input('length')]);
      
        $this->perPage = $request->input('length', 3);
      
        $admin = Auth::guard('admin')->user();

        if ($admin->hasPermissionTo('manage stores')) {
            // If the user has permission, retrieve the dealer IDs they can manage
            
            $dealerIds = $admin->managedDealers()->pluck('dealer_id')->toArray(); // Assuming managedDealers is a relation or method returning the IDs
        
            if( $dealerIds)
                $data = DealerSource::query()->makeQuery($input)->where('dealer_id','!=', 0)->whereIn('dealer_id', $dealerIds)->paginate($this->perPage);
            else
                $data = DealerSource::query()->makeQuery($input)->where('dealer_id','!=', 0)->paginate($this->perPage);
           
        } else {
            // If no permission, just query the data normally
            $data = DealerSource::query()->makeQuery($input)->where('dealer_id','!=', 0)->paginate($this->perPage);
        }
       // $data = DealerSource::makeQuery($input)->paginate($this->perPage);

        return response()->json([
            'data' => $data->items(),
            'draw' => $request->draw,
            'recordsTotal' => $data->total(),
            'recordsFiltered' => $data->total(),
        ]);
    }

    public function saveStore(Request $request)
    {
        $data = $request->all();

        $validator = Validator::make($data, [
            'dealership_name.*' => 'required|string|max:255',
            'dealer_id.*' => 'required',
            'source.*' => [
                'required',
                'string',
                function($attribute, $value, $fail) {
                    // Remove https://, http://, www., https://www., or http://www. from source
                    $value = preg_replace('/^(https?:\/\/)?(www\.)?/', '', $value);

                    $client = new Client();
                    $host = config('app.api_host');
                    $apiKey = config('app.api_key');

                    $params = ['rows' => 0, 'start' => 0, 'source' => $value];
                    try {
                        $vehiclelist = $this->marketcheckApiClient->getDealerSource($params);
                        if ($vehiclelist['num_found'] == 0) {
                            $fail('No Vehicle available for this ' . $value);
                        }
                    } catch (\Exception $e) {
                        $fail('The source ' . $value . ' is not valid.');
                    }

                    // Also check if the source exists in your local database
                    if (DealerSource::where('dealer_id', '!=', 0)
                                    ->where('source', strtolower($value))
                                    ->exists()) {
                        $fail('The source ' . $value . ' has already been taken.');
                    }
                }
            ],
            'adf_mail.*' => 'required|email|max:255',
            'email.*' => 'required|email|max:255',
            'phone.*' => 'required|max:10',
            'subscribed.*' => 'required|in:1,0',
            'address.*' => 'required|string|max:255',
            'zip_code.*' => 'required|string|max:10',
            'city.*' => 'required|string|max:255',
            'subscription_price.*' => 'nullable|numeric',
            'subscription_start_date.*' => 'nullable|date',
            'subscription_end_date.*' => 'nullable|date',
        ]);

        if ($validator->fails()) {
            $errors = $validator->errors();
            return $this->respondWithError('Validation Message', $errors, Response::HTTP_OK); 
        }

        foreach ($data['dealership_name'] as $index => $dealership_name) {
            // Remove https://, http://, www., https://www., or http://www. from source
            $store = strtolower(preg_replace('/^(https?:\/\/)?(www\.)?/', '', $data['source'][$index]));

            $source = DealerSource::where('dealer_id', 0)->where('source', $store)->first();
            if (!$source) {
                $store = DealerSource::create([
                    'dealer_id' => $data['dealer_id'][$index],
                    'dealership_name' => $dealership_name,
                    'source' => $store,
                    'adf_mail' => $data['adf_mail'][$index],
                    'email' => $data['email'][$index],
                    'phone' => $data['phone'][$index],
                    'subscribed' => $data['subscribed'][$index],
                    'address' => $data['address'][$index],
                    'zip_code' => $data['zip_code'][$index],
                    'city' => $data['city'][$index],
                    'state' => $data['state'][$index],
                    'latitude' => $data['latitude'][$index] ?? null,
                    'longitude' => $data['longitude'][$index] ?? null,
                    'is_manage_by_admin' => $data['subscription_type'][$index] ?? null,
                    'is_subscribed' => $data['subscription_type'][$index] ?? null,
                    'subscription_price' => $data['subscription_price'][$index] ?? null,
                    'call_tracking_number' => $data['call_tracking_number'][$index],
                    'call_track_sms' => $data['call_track_sms'][$index],
                    'cancelled_at' => $data['subscription_end_date'][$index] ?? null,
                    'free_trial' => $data['free_trial'][$index] ?? 0,
                    'free_trial_end_date' => $data['free_trial_end_date'][$index] ?? null,
                    'free_trial_start_date' => $data['free_trial_start_date'][$index] ?? null,
                ]);
                $lead = Lead::where('dealer_source', $store->source)->first();
                $visit = Visit::where('source', $store->source)->first();
                if ($lead) {
                    Lead::where('dealer_source', $store->source)->update(['store_id' => $store->id, 'dealer_id' => $data['dealer_id'][$index]]);
                }
                if ($visit) {
                    Visit::where('source', $store->source)->update(['store_id' => $store->id, 'dealer_id' => $data['dealer_id'][$index]]);
                }
            } else {
                $source->update([
                    'dealer_id' => $data['dealer_id'][$index],
                    'dealership_name' => $dealership_name,
                    'source' => $store,
                    'adf_mail' => $data['adf_mail'][$index],
                    'email' => $data['email'][$index],
                    'phone' => $data['phone'][$index],
                    'subscribed' => $data['subscribed'][$index],
                    'address' => $data['address'][$index],
                    'zip_code' => $data['zip_code'][$index],
                    'city' => $data['city'][$index],
                    'state' => $data['state'][$index],
                    'latitude' => $data['latitude'][$index] ?? null,
                    'longitude' => $data['longitude'][$index] ?? null,
                    'is_manage_by_admin' => $data['subscription_type'][$index] ?? null,
                    'is_subscribed' => $data['subscription_type'][$index] ?? null,
                    'subscription_price' => $data['subscription_price'][$index] ?? null,
                    'call_tracking_number' => $data['call_tracking_number'][$index],
                    'call_track_sms' => $data['call_track_sms'][$index],
                    'cancelled_at' => $data['subscription_end_date'][$index] ?? null,
                    'free_trial' => $data['free_trial'][$index] ?? 0,
                    'free_trial_end_date' => $data['free_trial_end_date'][$index] ?? null,
                    'free_trial_start_date' => $data['free_trial_start_date'][$index] ?? null,
                ]);
                $lead = Lead::where('dealer_source', $source->source)->first();
                $visit = Visit::where('source', $source->source)->first();
                if ($lead) {
                    Lead::where('dealer_source', $source->source)->update(['store_id' => $source->id, 'dealer_id' => $data['dealer_id'][$index]]);
                }
                if ($visit) {
                    Visit::where('source', $source->source)->update(['store_id' => $source->id, 'dealer_id' => $data['dealer_id'][$index]]);
                }
            }
        }

        return $this->respondWithSuccess('Store(s) registered successfully.', [], Response::HTTP_OK);
    }



    public function updateStore(Request $request)
    {
        $data = $request->all();
        $store = DealerSource::find($data['id']);

        $validator = Validator::make($data, [
            'id' => 'required|exists:dealer_source,id',
            'dealership_name' => 'required|string|max:255',
            'source' => [
                'required',
                'string',
                function($attribute, $value, $fail) use ($store) {
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

                    $value = strtolower($value);
                    if (DealerSource::where('dealer_id', '!=', 0)
                                    ->where('source', $value)
                                    ->where('id', '!=', $store->id)
                                    ->exists()) {
                        $fail('The source ' . $value . ' has already been taken.');
                    }
                }
            ],
            'email' => 'required|email|max:255',
            'phone' => 'required|max:10',
            'adf_mail' => 'required|email|max:255',
            'subscribed' => 'required|in:1,0',
            'address' => 'required|string|max:255',
            'zip_code' => 'required|string|max:10',
            'city' => 'required|string|max:255',
            //'latitude' => 'nullable|numeric',
            //'longitude' => 'nullable|numeric',
        ]);

        if ($validator->fails()) {
            $errors = $validator->errors();
            return $this->respondWithError('Validation Message', $errors, Response::HTTP_OK); 
        }

        $store->update([
            'dealer_id' => $data['dealer_id'],
            'dealership_name' => $data['dealership_name'],
            // Remove https://, http://, www., https://www., or http://www. from source before updating
            'source' => strtolower(preg_replace('/^(https?:\/\/)?(www\.)?/', '', $data['source'])),
            'email' => $data['email'],
            'phone' => $data['phone'],
            'adf_mail' => $data['adf_mail'],
            'address' => $data['address'],
            'zip_code' => $data['zip_code'],
            'city' => $data['city'],
            'state' => $data['state'],
            'latitude' => $data['latitude'] ?? null,
            'longitude' => $data['longitude'] ?? null,
            'is_manage_by_admin' => $data['is_manage_by_admin'] ?? 0,
            'subscribed' => $data['subscribed'] ?? null,
            'subscription_price' => $data['subscription_price'] ?? null,
            'call_tracking_number' => $data['call_tracking_number'],
            'call_track_sms' => $data['call_track_sms'],
            'is_subscribed' => $data['is_manage_by_admin'] ?? $store->is_subscribed,
            'cancelled_at' => $data['subscription_end_date'] ?? null,
            'free_trial' => $data['free_trial'] ?? 0,
            'free_trial_start_date' => $data['free_trial_start_date'] ?? null,
            'free_trial_end_date' => $data['free_trial_end_date'] ?? null,
        ]);

        Lead::where('dealer_source', $store->source)->update(['store_id' => $store->id, 'dealer_id' => $data['dealer_id']]);
        Visit::where('source', $store->source)->update(['store_id' => $store->id, 'dealer_id' => $data['dealer_id']]);

        return response()->json(['success' => true, 'message' => 'Store updated successfully.']);
    }


    public function deleteStore(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'id' => 'required|exists:dealer_source,id',
        ]);

        if ($validator->fails()) {
            return response()->json(['success' => false, 'errors' => $validator->errors()], Response::HTTP_OK);
        }

        DealerSource::find($request->id)->delete();

        return response()->json(['success' => true, 'message' => 'Store deleted successfully.']);
    }

    public function viewStore(Request $request)
    {
        $id = $request->store_id;
        $store = DealerSource::with('dealer')->find($id);
        return response()->json($store);
    }

    public function cancelSubscription(Request $request)
    {
      

        $validator = Validator::make($request->all(), [
            'id' => 'required|exists:dealer_source,id',
        ]);

        if ($validator->fails()) {
            return response()->json(['success' => false, 'errors' => $validator->errors()], 200);
        }
       
        $store = DealerSource::where('id', $request['id'])->first();
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 200);
        }

        if ($store->subscription_id) {
            $subscription = Subscription::where('id',$store->subscription_id)->first();
            
            if ($subscription) {
                // Cancel subscription in Stripe
                Stripe::setApiKey(env('STRIPE_SECRET'));

                try {
                    //$subscription = Subscription::retrieve($subscriby->id);
                    $subscription->cancel();
                    
                    // Update the subscription record in the database to reflect cancellation
                    $subscription->update([
                        'stripe_status' => 'canceled',
                        'ends_at' => now(),
                    ]);
                    
                } catch (\Exception $e) {
                    return response()->json(['success' => false, 'message' => 'Failed to cancel the subscription in Stripe: ' . $e->getMessage()], 500);
                }
            }
        }

        $store->update([
            'cancelled_at' => now(),
            'is_subscribed' => 0, // Update the subscription status
        ]);

        return $this->respondWithSuccess('Subscription cancelled successfully.', [], Response::HTTP_OK);
    }

    public function cancelRequest(Request $request){
        $dealerGroup = Dealer::all();
        return view('template.admin.store.cancel', compact('dealerGroup'));
    }

    public function cancelRequestData(Request $request){
       
        $input = $request->all();
        $data = CancellationRequest::makeQuery($input)->paginate($request->length);
        return response()->json([
            'data' => $data->items(),
            'draw' => $request->draw,
            'recordsTotal' => $data->total(),
            'recordsFiltered' => $data->total(),
        ]);
    }

    public function approveRequest(Request $request)
    {
      

        $validator = Validator::make($request->all(), [
            'id' => 'required|exists:cancellation_requests,id',
        ]);
        $id = $request->id;
        if ($validator->fails()) {
            return response()->json(['success' => false, 'errors' => $validator->errors()], 200);
        }
        $cancellationRequest = CancellationRequest::findOrFail($id);
     
        $cancellationRequest->update(['status' => 'approved']);
        $store = DealerSource::where('id', $cancellationRequest['dealer_source_id'])->first();
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 200);
        }
     
        #dd($store->subscription_id);
        if(!$store->is_manage_by_admin){
            if ($store->subscription_id) {
                // Cancel subscription in Stripe
            
                $store = DealerSource::where('id', $cancellationRequest['dealer_source_id'])->first();
                $subscription = Subscription::where('id',$store->subscription_id)->first();
                
                if ($subscription) {
                    // Cancel subscription in Stripe
                    Stripe::setApiKey(env('STRIPE_SECRET'));
                    try {
                        //$subscription = Subscription::retrieve($store->subscription_id);
                        $subscription->cancelNow();
                        
                        // Update the subscription record in the database to reflect cancellation
                        $subscription->update([
                            'stripe_status' => 'canceled',
                            'ends_at' => now(),
                        ]);
                        
                    } catch (\Exception $e) {
                        return response()->json(['success' => false, 'message' => 'Failed to cancel the subscription in Stripe: ' . $e->getMessage()], 500);
                    }
                }
            }
        }

        $store->update([
            'cancelled_at' => now(),
            'is_subscribed' => 0, // Update the subscription status
        ]);

        return $this->respondWithSuccess('Subscription cancelled successfully.', [], Response::HTTP_OK);
    }

    

    public function rejectRequest(Request $request)
    {   $id = $request->id;
        $cancellationRequest = CancellationRequest::findOrFail($id);
        $cancellationRequest->update(['status' => 'rejected']);

        return response()->json(['success' => true, 'message' => 'Cancellation request rejected.']);
    }

    public function downloadCsv(Request $request)
    {
        $input = $request->all();
        $stores = $data = DealerSource::query()->makeQuery($input)->get();

        $filename = "stores.csv";
        $handle = fopen($filename, 'w+');
        fputcsv($handle, [
            'ID',
            'Dealership Group',
            'Dealership Store',
            'Dealership Website',
            'ADF Email',
            'Subscription Enabled',
            'Subscription Type',
            'Subscription Price',
            'Subscription Status',
            'Expiry Date',
            'External Dealer ID',
            //'Subscribed',
            'Subscription Plan',
            'Address',
            'Zip Code',
            'City',
            'Latitude',
            'Longitude',
            'Created At',
            'Updated At'
        ]);

        foreach ($stores as $store) {
            fputcsv($handle, [
                $store->id,
                $store->dealer->dealership_group ?? '',
                $store->dealership_name,
                $store->source,
                $store->adf_mail,
                $store['subscribed'] == 1 ? 'Enabled' : 'Disabled',
                $store->is_manage_by_admin == 0 ? 'Default' : 'Manual',
                $store->subscription_price,
                $store->is_subscribed == 1 ? 'Subscribed' : 'Not Subscribed',
                $store->cancelled_at,
                $store->external_dealer_id,
                //$store->subscribed,
                $store->subscription_plan,
                $store->address,
                $store->zip_code,
                $store->city,
                $store->latitude,
                $store->longitude,
                $store->created_at,
                $store->updated_at
            ]);
        }

        fclose($handle);

        return response()->download($filename)->deleteFileAfterSend(true);
    }

    
}
