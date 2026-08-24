<?php

namespace App\Http\Controllers\Admin;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Validator;

use App\Http\Traits\ApiResponseTrait;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;
use Illuminate\Support\Facades\Mail;
use App\Models\Post;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use App\Helpers\Slug;
use App\Jobs\SendDealerVerificationEmail;
use App\Mail\DealerNewPasswordNotification;
use App\Mail\AdminDealerCredentialMail;
use Illuminate\Support\Facades\Hash;
use App\Models\Dealer;
use App\Models\DealerSource;
use App\Models\ChatSetting;
use App\Models\DealerSocialAccount;
use Laravel\Cashier\Subscription;
use Illuminate\Support\Facades\Http;
use App\Services\MarketcheckApiClient;
use Illuminate\Support\Facades\Response;
use Stripe\Stripe;

class AdminDealerController extends Controller
{
    use ApiResponseTrait;

    protected $marketcheckApiClient;

    public function __construct(MarketcheckApiClient $marketcheckApiClient)
    {
        $this->marketcheckApiClient = $marketcheckApiClient;
    }
    /**
     * Display a listing of dealers.
     *
     * @param Request $request
     * @return \Illuminate\View\View
     */
    public function dealerlist(Request $request)
    {
       // $dealer = Dealer::all();
       $admin = Auth::guard('admin')->user();
       $dealer = Dealer::paginate(10);
      
        return view('template.admin.dealerlist', compact('dealer'));
    }

    /**
     * Display the list of all dealers.
     *
     * @return \Illuminate\View\View
     */
    public function alldealers()
    {
        return view('template.admin.alldealers');
    }

    public function dealerRegister(Request $request){
        $data = $request->all();

        $validator = Validator::make($data, [
            'dealership_url' => [
                'required',
                'string',
                function($attribute, $value, $fail)  {
                    // Remove https://, http://, www., https://www., or http://www. from source
                    $value = preg_replace('/^(https?:\/\/)?(www\.)?/', '', $value);

                    $params = ['rows'=>0,'start'=>0,'source'=>$value];
                    try {
                        $vehiclelist = $this->marketcheckApiClient->getDealerSource($params);
                        //if ($vehiclelist['num_found'] == 0) {
                        //    $fail('No Vehicle available for this ' . $value);
                        //}
                    } catch (\Exception $e) {
                        $fail('The source ' . $value . ' is not valid.');
                    }

                    if (ChatSetting::where('dealership_url', strtolower($value))->exists()) {
                        $fail('The source ' . $value . ' has already been taken.');
                    }
                }
            ],
            'logo' => 'nullable|image|mimes:jpeg,png,jpg,gif|max:2048',
            'icon_logo' => 'nullable|image|mimes:jpeg,png,jpg,gif|max:2048',
            'chatbot_name' => 'nullable|string',
            'dealership_name' => 'nullable|string',
            'primary_color' => 'nullable|string',
            'secondary_color' => 'nullable|string',
            'welcome_message' => 'nullable|string',
            'adf_mail' => 'nullable|string',
            'name' => 'required|string|max:255',
            'email' => 'required|string|email|max:255|unique:dealers',
            'password' => 'required|string|min:8|same:confirm_password',
            'confirm_password' => 'required|string|min:8', // Add this line
            'phone_number' => 'required|numeric|digits:10|unique:dealers',
            'subscribed' => 'required|in:1,0',
           
            'subscription_price' => 'nullable|numeric',
            'subscription_start_date' => 'nullable|date',
            'subscription_end_date' => 'nullable|date',
            
            // Managerial Contact fields
            'managerial_contact_phone' => 'nullable|string|max:20',
            'managerial_contact_email' => 'nullable|email|max:255',
            
            // Store Hours fields
            'timezone' => 'nullable|string|max:50',
            'is_store_hours_enabled' => 'nullable|boolean',
            'closed_message' => 'nullable|string|max:500',
            'store_hours' => 'nullable|array',
            'store_hours.*.open' => 'nullable|date_format:H:i',
            'store_hours.*.close' => 'nullable|date_format:H:i',
            'store_hours.*.closed' => 'nullable|boolean',
        ]);
        if ($validator->fails()) {
            $errors = $validator->errors();
            return $this->respondWithError('Validation Message', $errors, 200); 
        }
        $dealer = Dealer::create([
            'name' => $request->name,
            'email' => $request->email,
            'phone_number' => $request->phone_number,
            'password' => Hash::make($request->password),
            'email_'
          

        ]);
        $dealer->markEmailAsVerified();

        Mail::to($dealer->email)->send(new AdminDealerCredentialMail($dealer,$request->password));


        $data = $request->only('position','dealership_url','adf_mail', 'dealership_name','chatbot_name', 'primary_color', 'secondary_color', 'welcome_message', 'managerial_contact_phone', 'managerial_contact_email', 'timezone', 'is_store_hours_enabled', 'closed_message', 'store_hours');
        $dealership_url = preg_replace('/^(https?:\/\/)?(www\.)?/', '', strtolower($data['dealership_url']));
        $source_data = $request->all();
        $store = DealerSource::create([
            'dealer_id' => $dealer->id,
            'dealership_name' => $source_data['chatbot_name'],
            'source' => $dealership_url,
            'subscribed' => $source_data['subscribed'],
            'is_manage_by_admin' => $source_data['subscription_type'] ?? null,
            'is_subscribed' => $source_data['subscription_type'] ?? null,
            'cancelled_at' => $source_data['subscription_end_date'] ?? null,
            'free_trial' => $source_data['free_trial'] ?? 0,
            'free_trial_end_date' => $source_data['free_trial_end_date'] ?? null,
            'free_trial_start_date' => $source_data['free_trial_start_date'] ?? null,
        ]);
        $data['dealership_url'] =$dealership_url;
        if ($request->hasFile('logo')) {
            // Delete old logo if exists
           

            // Store the new logo
            $filePath = $request->file('logo')->store('logos', 's3');
            $data['logo'] = Storage::disk('s3')->url($filePath);
        }
        if ($request->hasFile('icon_logo')) {
            $filePath = $request->file('icon_logo')->store('icon_logo', 's3');
            $data['icon_logo'] = Storage::disk('s3')->url($filePath);
        }
        $data['dealer_id']= $dealer->id;
        $data['store_id']= $store->id;
        $data['uuid']  = Str::uuid()->toString();
        $ChatSetting = ChatSetting::create($data);
        return $this->respondWithSuccess('Store(s) registered successfully.', [], 200);
    }

    public function dealerUpdate(Request $request)
    {
        $data = $request->all();
        $dealer_id = $data['dealer_id'];
        // Validate the incoming data
        $validator = Validator::make($data, [
            'dealership_url' => [
                'required',
                'string',
                function ($attribute, $value, $fail) use($dealer_id){
                  
                    $value = preg_replace('/^(https?:\/\/)?(www\.)?/', '', $value);

                    $params = ['rows' => 0, 'start' => 0, 'source' => $value];
                    try {
                        $vehiclelist = $this->marketcheckApiClient->getDealerSource($params);
                        //if ($vehiclelist['num_found'] == 0) {
                        //    $fail('No Vehicle available for this ' . $value);
                        //}
                    } catch (\Exception $e) {
                        $fail('The source ' . $value . ' is not valid.');
                    }

                    if (ChatSetting::where('dealership_url', strtolower($value))
                        ->where('dealer_id', '!=', $dealer_id)
                        ->exists()) {
                        $fail('The source ' . $value . ' has already been taken.');
                    }
                }
            ],
            'logo' => 'nullable|image|mimes:jpeg,png,jpg,gif|max:2048',
            'icon_logo' => 'nullable|image|mimes:jpeg,png,jpg,gif|max:2048',
            'chatbot_name' => 'nullable|string',
            'dealership_name' => 'nullable|string',
            'primary_color' => 'nullable|string',
            'secondary_color' => 'nullable|string',
            'welcome_message' => 'nullable|string',
            'adf_mail' => 'nullable|string',
            'name' => 'required|string|max:255',
            'email' => 'required|string|email|max:255|unique:dealers,email,' . $dealer_id,
            'phone_number' => 'required|numeric|digits:10|unique:dealers,phone_number,' . $dealer_id,
            'subscribed' => 'required|in:1,0',
            'subscription_price' => 'nullable|numeric',
            'subscription_start_date' => 'nullable|date',
            'subscription_end_date' => 'nullable|date',
            
            // Managerial Contact fields
            'managerial_contact_phone' => 'nullable|string|max:20',
            'managerial_contact_email' => 'nullable|email|max:255',
            
            // Store Hours fields
            'timezone' => 'nullable|string|max:50',
            'is_store_hours_enabled' => 'nullable|boolean',
            'closed_message' => 'nullable|string|max:500',
            'store_hours' => 'nullable|array',
            'store_hours.*.open' => 'nullable|date_format:H:i',
            'store_hours.*.close' => 'nullable|date_format:H:i',
            'store_hours.*.closed' => 'nullable|boolean',
        ]);

        // If validation fails, return the error response
        if ($validator->fails()) {
            $errors = $validator->errors();
            return $this->respondWithError('Validation Message', $errors, 200);
        }

        // Fetch the dealer to update
        $dealer = Dealer::findOrFail($dealer_id);

        // Update the dealer data
        $dealer->update([
            'name' => $request->name,
            'email' => $request->email,
            'phone_number' => $request->phone_number,
        ]);

        // Handle the storelist
        $storeData = $request->only('chatbot_name', 'subscription_type','subscription_price', 'subscribed', 'subscription_end_date', 'free_trial', 'free_trial_start_date', 'free_trial_end_date');

        $dealership_url = preg_replace('/^(https?:\/\/)?(www\.)?/', '', strtolower($request->dealership_url));
        $existingStore = DealerSource::where('dealer_id', $dealer_id)->first();

        // Find the dealer's store entry or create a new one if it doesn't exist
        $store = DealerSource::updateOrCreate(
            ['dealer_id' => $dealer_id],
            [
                'dealership_name' => $storeData['chatbot_name'],
                'source' => $dealership_url,
                'subscribed' => $storeData['subscribed'],
                'is_manage_by_admin' =>  $storeData['subscription_type'] ?? $existingStore['subscription_type']??0,
                'is_subscribed' => $storeData['subscription_type'] ?? $existingStore['subscription_type']??0,
                'cancelled_at' => $storeData['subscription_end_date'] ?? null,
                'subscription_price' => $storeData['subscription_price'] ?? null,
                'free_trial' => $storeData['free_trial'] ?? 0,
                'free_trial_end_date' => $storeData['free_trial_end_date'] ?? null,
                'free_trial_start_date' => $storeData['free_trial_start_date'] ?? null,
            ]
        );
       // dd($store);

        // Handle chat settings
        $chatData = $request->only('dealership_url', 'adf_mail', 'dealership_name', 'chatbot_name', 'primary_color', 'secondary_color', 'welcome_message', 'managerial_contact_phone', 'managerial_contact_email', 'timezone', 'is_store_hours_enabled', 'closed_message', 'store_hours');
        $chatData['dealership_url'] = $dealership_url;
        $chatData['store_id'] = $store->id;

        // Handle logo and icon logo upload
        if ($request->hasFile('logo')) {
            // Delete old logo if it exists
            // Store the new logo
            $filePath = $request->file('logo')->store('logos', 's3');
            $chatData['logo'] = Storage::disk('s3')->url($filePath);
        }

        if ($request->hasFile('icon_logo')) {
            $filePath = $request->file('icon_logo')->store('icon_logo', 's3');
            $chatData['icon_logo'] = Storage::disk('s3')->url($filePath);
        }

        // Find the chat settings for the dealer or create if it doesn't exist
        ChatSetting::updateOrCreate(
            ['dealer_id' => $dealer_id],
            $chatData
        );

        // Return success response
        return $this->respondWithSuccess('Dealer updated successfully.', [], 200);
    }


   

   

    /**
     * Change the password of a dealer.
     *
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function changePassword(Request $request)
    {
        $data = $request->all();

        // Validate the request data
        $validator = Validator::make($data, [
            'password' => 'required|string|min:8|confirmed',
        ]);

        // Return validation errors if any
        if ($validator->fails()) {
            $errors = $validator->errors();
            return $this->respondWithError('Validation Message', $errors, 200);
        }

        // Find the dealer and update the password
        $dealer = Dealer::find($request->dealer_id);
        Mail::to($dealer->email)->send(new DealerNewPasswordNotification($dealer, $request->password));

      
        $dealer->update([
            'password' => Hash::make($request->password),
        ]);

        // Return success response
        return $this->respondWithSuccess('Password updated successfully.', null, 200);
    }

    /**
     * Get dealer details for editing.
     *
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function dealerlist_edit(Request $request)
    {
        $dealer_id = $request->get('dealer_id');
        $input['id'] = $dealer_id ;
        $dealer = Dealer::query()->makeQuery($input)->first();
        return response()->json($dealer);
    }

    /**
     * Get dealer data for DataTables.
     *
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function dealerlist_tableData(Request $request)
    {
        $request->merge(['page' => (($request->input('start') / $request->input('length')) + 1)]);
        $request->merge(['perPage' => $request->input('length')]);
        $this->perPage = $request->input('length', 3);
        //$this->perPage =2;
        $input = $request->all();
        //$input['parent_id'] = 0;
        $admin = Auth::guard('admin')->user();

      
            // If no permission, just query the data normally
        $data = Dealer::query()->makeQuery($input)->paginate($this->perPage);
        #dd($data);
        // Return data for DataTables
        return response()->json([
            'data' => $data->items(),
            'draw' => $request->input('draw'),
            'recordsTotal' => $data->total(),
            'recordsFiltered' => $data->total(),
        ]);
    }

    /**
     * Delete a dealer.
     *
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function dealerlist_delete(Request $request)
    {
        // Validate the request data
        $validator = Validator::make($request->all(), [
            'dealer_id' => 'required|exists:dealers,id',
        ]);

        // Return validation errors if any
        if ($validator->fails()) {
            return response()->json(['success' => false, 'errors' => $validator->errors()], 422);
        }

        // Delete the dealer
        $dealersource = DealerSource::where('dealer_id', $request->dealer_id)->first();
        if($dealersource){
            DealerSource::where('dealer_id', $request->dealer_id)->delete();
        }
        $ChatSetting = ChatSetting::where('dealer_id', $request->dealer_id)->first();
        if($ChatSetting){
            ChatSetting::where('dealer_id', $request->dealer_id)->delete();
        }
       
        // Check if any dealers have the given dealer_id as their parent_id before deleting them
      
        
        // Finally, delete the dealer itself
        Dealer::find($request->dealer_id)->delete();

        // Return success response
        return response()->json(['success' => true, 'message' => 'Store deleted successfully.']);
    }

    /**
     * Download dealer data as a CSV file.
     *
     * @param Request $request
     * @return \Illuminate\Http\Response
     */
    public function downloadCSV(Request $request)
    {
       
       $input = $request->all();
    
       $dealers = Dealer::query()->makeQuery($input)->get();
        // Fetch the filtered data
       // $dealers = $query->get();
    
        // Define the CSV headers
        $headers = [
            'ID', 'Name', 'Email', 'Phone Number', 'Chatbot Name', 
            'Dealership Name', 'Website', 'ADF Email', 
            'Subscription Status', 'Subscription Type', 
            'Free Trial', 'Free Trial Start', 'Free Trial End', 
            'Subscription Price', 'Subscription Expiry Date'
        ];
    
        // Create a CSV file in memory
        $callback = function() use ($dealers, $headers) {
            $file = fopen('php://output', 'w');
            fputcsv($file, $headers); // Write the headers
    
            foreach ($dealers as $dealer) {
                // Get related data
                $storelist = $dealer->storelist;
                $chatSetting = $dealer->chatSetting;
    
                $row = [
                    $dealer->id,
                    $dealer->name,
                    $dealer->email,
                    $dealer->phone_number,
                    optional($chatSetting)->chatbot_name ?? 'N/A',
                    optional($storelist)->dealership_name ?? 'N/A',
                    optional($chatSetting)->dealership_url ?? 'N/A',
                    optional($chatSetting)->adf_mail ?? 'N/A',
                    optional($storelist)->is_subscribed == 1 ? 'Subscribed' : 'Not Subscribed',
                    optional($storelist)->is_manage_by_admin == 1 ? 'Manual Payment' : 'Automated',
                    optional($storelist)->free_trial == 1 ? 'Yes' : 'No',
                    optional($storelist)->free_trial_start_date ?? 'N/A',
                    optional($storelist)->free_trial_end_date ?? 'N/A',
                    optional($storelist)->subscription_price ?? 'N/A',
                    optional($storelist)->cancelled_at ?? 'N/A',
                ];
    
                fputcsv($file, $row); // Write the row data
            }
    
            fclose($file); // Close the file
        };
    
        // Return the response with headers
        return Response::stream($callback, 200, [
            "Content-Type" => "text/csv",
            "Content-Disposition" => "attachment; filename=dealers.csv",
        ]);
    }

    public function loginAs(Request $request){
        $id = $request->dealer; 
        $dealer = Dealer::where('id',$id)->first();
        Auth::guard('dealer')->login($dealer);
        return  redirect()->route('dealer.profile');
    }

    /**
     * Cancel dealer subscription
     */
    public function cancelDealerSubscription(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'dealer_id' => 'required|exists:dealers,id',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid dealer ID',
                'errors' => $validator->errors()
            ], 200);
        }

        try {
            $dealer = Dealer::with('storelist')->find($request->dealer_id);
            
            if (!$dealer) {
                return response()->json([
                    'success' => false,
                    'message' => 'Dealer not found.'
                ], 200);
            }

            $store = $dealer->storelist;
            
            if (!$store) {
                return response()->json([
                    'success' => false,
                    'message' => 'Store not found for this dealer.'
                ], 200);
            }

            // Check if subscription is automated (not managed by admin)
            if ($store->is_manage_by_admin != 0) {
                return response()->json([
                    'success' => false,
                    'message' => 'This is a manual subscription and cannot be cancelled this way.'
                ], 200);
            }

            // Check if there's an active subscription
            if ($store->is_subscribed != 1) {
                return response()->json([
                    'success' => false,
                    'message' => 'No active subscription found.'
                ], 200);
            }

            // Cancel the Stripe subscription if exists
            if ($store->subscription_id) {
                $subscription = Subscription::find($store->subscription_id);
                
                if ($subscription && $subscription->stripe_id) {
                    Stripe::setApiKey(env('STRIPE_SECRET'));
                    
                    try {
                        $stripeSubscription = \Stripe\Subscription::retrieve($subscription->stripe_id);
                        $stripeSubscription->cancel();
                        
                        // Update subscription status
                        $subscription->update([
                            'stripe_status' => 'canceled',
                            'ends_at' => now(),
                        ]);
                    } catch (\Exception $e) {
                        \Log::error('Stripe subscription cancellation failed', [
                            'dealer_id' => $dealer->id,
                            'error' => $e->getMessage()
                        ]);
                        
                        return response()->json([
                            'success' => false,
                            'message' => 'Failed to cancel subscription in Stripe: ' . $e->getMessage()
                        ], 500);
                    }
                }
            }

            // Update store subscription status
            $store->update([
                'is_subscribed' => 0,
                'cancelled_at' => now(),
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Subscription cancelled successfully!'
            ], 200);

        } catch (\Exception $e) {
            \Log::error('Dealer subscription cancellation failed', [
                'dealer_id' => $request->dealer_id,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'An error occurred while cancelling the subscription: ' . $e->getMessage()
            ], 500);
        }
    }

  
}
