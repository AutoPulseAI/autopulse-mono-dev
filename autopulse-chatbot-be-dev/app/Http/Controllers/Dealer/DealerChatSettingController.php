<?php
 
namespace App\Http\Controllers\Dealer;
use App\Models\Dealer;
use App\Models\DealerSource;
use App\Models\Visit;
use App\Models\Plan;
use App\Models\ChatSetting;
use Illuminate\View\View;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Session;
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


class DealerChatSettingController extends Controller
{
    use ApiResponseTrait;
    /**
     * Display the dashboard for the authenticated user.
     *
     * @return \Illuminate\Contracts\View\View
     */

    protected $subscriptionService,$marketcheckApiClient;

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
       
        $dealer = Auth::guard('dealer')->user();
        $parentId = $dealer->id;
        $mainDealer = app('mainDealer');
        $storeList = app('storeList');
       
        $chatbotSetting = ChatSetting::where('dealer_id', $parentId)->first();
        //dd($chatbotSetting);
        return view('template.dealers.chat',compact('dealer','chatbotSetting'));
    }

     /**
     * update the add role 
     *
     * @return \Illuminate\Contracts\View\View
    */

    public function add(Request $request)
    {
        $dealer = Auth::guard('dealer')->user();
        $parentId = $dealer->id;
        
        $validator = Validator::make($request->all(), [
            
            'dealership_url' => [
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
            
            // Store Address Information
            'store_address' => 'nullable|string|max:500',
            'store_city' => 'nullable|string|max:100',
            'store_state' => 'nullable|string|max:50',
            'store_zip' => 'nullable|string|max:20',
            'store_country' => 'nullable|string|max:100',
            
            // Contact Person Information
            'contact_person_name' => 'nullable|string|max:100',
            'contact_person_phone' => 'nullable|string|max:20',
            'contact_person_email' => 'nullable|email|max:100',
            
            // Managerial Contact Information
            'managerial_contact_phone' => 'nullable|string|max:20',
            'managerial_contact_email' => 'nullable|email|max:100',
            
            // Timezone and Store Hours
            'timezone' => 'nullable|string|max:50',
            'store_hours' => 'nullable|array',
            'store_hours.*.open' => 'required_unless:store_hours.*.closed,1|date_format:H:i',
            'store_hours.*.close' => 'required_unless:store_hours.*.closed,1|date_format:H:i',
            'store_hours.*.closed' => 'nullable|boolean',
            'is_store_hours_enabled' => 'nullable|boolean',
            'closed_message' => 'nullable|string|max:500',
        ]);

        if ($validator->fails()) {
            return response()->json(['success' => false, 'data' => $validator->errors()], 400);
        }
       

        $data = $request->only([
            'position', 'store_id', 'adf_mail', 'dealership_name', 'dealership_url', 
            'chatbot_name', 'primary_color', 'secondary_color', 'welcome_message',
            // Store Address Information
            'store_address', 'store_city', 'store_state', 'store_zip', 'store_country',
            // Contact Person Information  
            'contact_person_name', 'contact_person_phone', 'contact_person_email',
            // Managerial Contact Information
            'managerial_contact_phone', 'managerial_contact_email',
            // Timezone and Store Hours
            'timezone', 'store_hours', 'is_store_hours_enabled', 'closed_message'
        ]);
        
        $dealership_url = preg_replace('/^(https?:\/\/)?(www\.)?/', '', strtolower($data['dealership_url']));
        $data['dealership_url'] = $dealership_url;
        
        // Process store hours data
        if (isset($data['store_hours']) && is_array($data['store_hours'])) {
            $processedHours = [];
            foreach ($data['store_hours'] as $day => $hours) {
                $processedHours[$day] = [
                    'open' => $hours['open'] ?? '09:00',
                    'close' => $hours['close'] ?? '18:00',
                    'closed' => isset($hours['closed']) && $hours['closed'] ? true : false
                ];
            }
            $data['store_hours'] = $processedHours;
        } else {
            $data['store_hours'] = ChatSetting::getDefaultStoreHours();
        }
        
        // Set defaults for new fields
        $data['store_country'] = $data['store_country'] ?? 'USA';
        $data['timezone'] = $data['timezone'] ?? 'America/New_York';
        $data['is_store_hours_enabled'] = isset($data['is_store_hours_enabled']) ? true : false;
        $store = DealerSource::create([
            'dealer_id' => $parentId,
            'dealership_name' => $data['chatbot_name'],
            'source' => $dealership_url]);
        if ($request->hasFile('logo')) {
            $filePath = $request->file('logo')->store('logos', 's3');
            $data['logo'] = Storage::disk('s3')->url($filePath);
        }
        if ($request->hasFile('icon_logo')) {
            $filePath = $request->file('icon_logo')->store('icon_logo', 's3');
            $data['icon_logo'] = Storage::disk('s3')->url($filePath);
        }
        $data['dealer_id']= $parentId;
        $data['store_id']= $store->id;
        $data['uuid']  = Str::uuid()->toString();
        $ChatSetting = ChatSetting::create($data);
       

        return response()->json(['success' => true, 'message' => 'Chatbot setting created successfully.', 'data' => $ChatSetting]);
    }

    public function update(Request $request)
    {
        $dealer = Auth::guard('dealer')->user();
        $parentId = $dealer->id;
        $ChatSetting = Chatsetting::where('id',$request->id)->first();
        if (!$ChatSetting) {
            \Log::error('ChatSetting instance not found.');
            return response()->json(['success' => false, 'message' => 'Chatbot setting not found.'], 404);
        }
      
        $validator = Validator::make($request->all(), [
            
            'dealership_url' => [
                'required',
                'string',
                function($attribute, $value, $fail) use ($ChatSetting) {
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
                    if (Chatsetting:: where('dealership_url', $value)
                                    ->where('id', '!=', $ChatSetting->id)
                                    ->exists()) {
                        $fail('The source ' . $value . ' has already been taken.');
                    }
                }
            ],
            
            
            'logo' => 'nullable|image|mimes:jpeg,png,jpg,gif|max:2048',
            'icon_logo' => 'nullable|image|mimes:jpeg,png,jpg,gif|max:2048',
            'dealership_name' => 'nullable|string',
            'chatbot_name' => 'nullable|string',
            'primary_color' => 'nullable|string',
            'secondary_color' => 'nullable|string',
            'welcome_message' => 'nullable|string',
            'adf_mail' => 'nullable|string',
            
            // Store Address Information
            'store_address' => 'nullable|string|max:500',
            'store_city' => 'nullable|string|max:100',
            'store_state' => 'nullable|string|max:50',
            'store_zip' => 'nullable|string|max:20',
            'store_country' => 'nullable|string|max:100',
            
            // Contact Person Information
            'contact_person_name' => 'nullable|string|max:100',
            'contact_person_phone' => 'nullable|string|max:20',
            'contact_person_email' => 'nullable|email|max:100',
            
            // Managerial Contact Information
            'managerial_contact_phone' => 'nullable|string|max:20',
            'managerial_contact_email' => 'nullable|email|max:100',
            
            // Timezone and Store Hours
            'timezone' => 'nullable|string|max:50',
            'store_hours' => 'nullable|array',
            'store_hours.*.open' => 'required_unless:store_hours.*.closed,1|date_format:H:i',
            'store_hours.*.close' => 'required_unless:store_hours.*.closed,1|date_format:H:i',
            'store_hours.*.closed' => 'nullable|boolean',
            'is_store_hours_enabled' => 'nullable|boolean',
            'closed_message' => 'nullable|string|max:500',
        ]);
      
        if ($validator->fails()) {
            return response()->json(['success' => false, 'data' => $validator->errors()], 400);
        }
        $store = DealerSource::where('id',$parentId)->first();
       
       

        $data = $request->only([
            'position', 'dealership_url', 'adf_mail', 'dealership_name', 'chatbot_name', 
            'primary_color', 'secondary_color', 'welcome_message',
            // Store Address Information
            'store_address', 'store_city', 'store_state', 'store_zip', 'store_country',
            // Contact Person Information  
            'contact_person_name', 'contact_person_phone', 'contact_person_email',
            // Managerial Contact Information
            'managerial_contact_phone', 'managerial_contact_email',
            // Timezone and Store Hours
            'timezone', 'store_hours', 'is_store_hours_enabled', 'closed_message'
        ]);
        
        $dealership_url = preg_replace('/^(https?:\/\/)?(www\.)?/', '', strtolower($data['dealership_url']));
        
        if(!$store){
            $store = DealerSource::create([
               'dealer_id' => $parentId,
               'dealership_name' => $data['dealership_name'],
               'source' => $dealership_url,
               'is_manage_by_admin'=>0

           ]);
       }else{
        $store =$store->update([
            'dealer_id' => $parentId,
            'dealership_name' => $data['dealership_name'],
            'source' => $dealership_url

        ]);

       }
       #dd($data,$store);
        $data['dealership_url'] = $dealership_url;
        
        // Process store hours data
        if (isset($data['store_hours']) && is_array($data['store_hours'])) {
            $processedHours = [];
            foreach ($data['store_hours'] as $day => $hours) {
                $processedHours[$day] = [
                    'open' => $hours['open'] ?? '09:00',
                    'close' => $hours['close'] ?? '18:00',
                    'closed' => isset($hours['closed']) && $hours['closed'] ? true : false
                ];
            }
            $data['store_hours'] = $processedHours;
        }
        
        // Set defaults for new fields if not provided
        if (isset($data['store_country']) && empty($data['store_country'])) {
            $data['store_country'] = 'USA';
        }
        if (isset($data['timezone']) && empty($data['timezone'])) {
            $data['timezone'] = 'America/New_York';
        }
        $data['is_store_hours_enabled'] = isset($data['is_store_hours_enabled']) ? true : false;
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

        // Update the UUID
        //$data['uuid'] = Str::uuid()->toString();

        // Update the ChatSetting and capture the result
        $updated = $ChatSetting->update($data);

        if ($updated) {
            return response()->json(['success' => true, 'message' => 'Chatbot setting updated successfully.', 'data' => $ChatSetting]);
        } else {
            \Log::error('Update failed:', ['data' => $data, 'ChatSetting' => $ChatSetting]);
            return response()->json(['success' => false, 'message' => 'Failed to update chatbot setting.'], 500);
        }
    }


    public function getUserChatbotSettings($userId)
    {
        $chatbotSetting = ChatSetting::where('uuid', $userId)->first();
       // dd( $chatbotSetting );
        $dealer_id = $chatbotSetting->dealer_id;
       
        $dealer = Dealer::where('id',$dealer_id)->first();
        // Resolve the exact store this chatbot widget belongs to (chatbot_settings.store_id),
        // rather than an arbitrary store of the dealer's — a dealer can have multiple stores.
        $dealersource = $chatbotSetting->store_id
            ? DealerSource::find($chatbotSetting->store_id)
            : DealerSource::where('dealer_id',$dealer_id)->first();
        #$dealersource->cancelled_at ='2010-10-10';
       // dd( $dealersource );
        if($dealersource && $dealersource->is_subscribed && (!($dealersource->cancelled_at) || (\Carbon\Carbon::now()->lessThanOrEqualTo(\Carbon\Carbon::parse($dealersource->cancelled_at)) ))){
            
        
            if ($chatbotSetting) {
                return response()->json([
                    'success' => true,
                    'data' => $chatbotSetting
                ]);
            } else {
                return response()->json([
                    'success' => false,
                    'message' => 'No chatbot settings found for this user.'
                ], 404);
            }
        }else {
            return response()->json([
                'success' => false,
                'message' => 'No chatbot settings found for this user.'
            ], 404);
        }
    }

    public function conversation(){
        return view('template.dealers.conversation');
    }


}

