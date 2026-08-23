<?php
 
namespace App\Http\Controllers\Dealer;
 
use App\Models\dealer;
use App\Models\Visit;
use App\Models\Booking;
use App\Models\FacebookBookingTracking;
use App\Models\clickCallSms;
use Illuminate\View\View;
use App\Models\Lead;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Session;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Str;
use App\Services\SnsService;
use App\Services\AuthService;
use App\Http\Traits\ApiResponseTrait;
use  Illuminate\Http\Response;
use Validator;
use Illuminate\Validation\Rule;
use Illuminate\Support\Facades\Storage;
use App\Http\Controllers\Controller;
use App\Services\MarketcheckApiClient;
use Illuminate\Support\Facades\Response as streamreponse;

class DealerController extends Controller
{
    use ApiResponseTrait;
    /**
     * Display the dashboard for the authenticated user.
     *
     * @return \Illuminate\Contracts\View\View
     */

    protected $marketcheckApiClient;

    public function __construct(MarketcheckApiClient $marketcheckApiClient)
    {
        $this->marketcheckApiClient = $marketcheckApiClient;
    }

    public function dashboard(Request $request){
        $dealer = Auth::guard('dealer')->user();
        //$dealer->source = 'willmarcars.com';
        
        
        $params = ['rows'=>10,'start'=>0,'source'=>$dealer->source];
        $vehiclelist = $this->marketcheckApiClient->getDealerSource($params);

        $query = Lead::with('user')->where('dealer_source', $dealer->source);

        $subscription = $dealer->subscription('default');
       
        if ($subscription) {
            if ($request->filled('vin')) {
                $query->where('vin', $request->vin);
            }
            if (!$subscription->canceled()) {
                $leads = $query->orderBy('id', 'desc')->get(5);
            } else {
                $currentDate = now();
                $subscriptionEndDate = $subscription->ends_at;
                if ($currentDate->lt($subscriptionEndDate)) {
                    $leads = $query->where('created_at', '<=', $subscriptionEndDate)->orderBy('id', 'desc')->get(5);
                }
            }
        } else {
            $leads = $query->orderBy('id', 'asc')->take(5)->get();
        }

    }

    public function index(Request $request): View
    {
        $dealer = Auth::guard('dealer')->user();
        $mainDealer = app('mainDealer');
        $storeList = app('storeList');
        $parentId = app('parentId');
        if(isset($request['source']) && !empty($request['source'])  && $request['source'] !='All')
        {   $allstore =[$request['source']];
            $params = ['rows'=>10,'start'=>0,'source'=>$request['source']];
        }else{
            $allstore = $storeList->pluck('source')->toArray();
            $stores = implode(',',$allstore);
            $params = ['rows'=>10,'start'=>0,'source'=>$stores];
        }
        $vehiclelist = $this->marketcheckApiClient->getDealerSource($params);
        $query = Lead::with('user')->whereIn('dealer_source', $allstore);
        $totalCount = $query->count();
        $subscription = $dealer->subscription('default');
        $leads = $query->orderBy('id', 'desc')->take(5)->get();
        $vehiclecount = $vehiclelist['num_found'];
        $visitCount = Visit::whereIn('source',$allstore)->count() ;

        $vinArray = $leads->pluck('vin')->all();
        $vinList = implode(',', $vinArray);
        $params = [
            'start' =>0,
            'rows' => 30,
            'vin' => $vinList
        ];
        $vehicleList = count($vinArray) > 0
            ? $this->marketcheckApiClient->searchActiveCars($params)
            : ['listings' => [], 'num_found' => 0];

        // Get VINs from the vehicle listings
        $listingVins = collect($vehicleList['listings'])->pluck('vin')->all();

        // Filter leads to include only those with VINs in the listings
        $filteredLeads = $leads->filter(function ($lead) use ($listingVins) {
            return in_array($lead->vin, $listingVins);
        });

        foreach ($vehicleList['listings'] as $listing) {
            $filteredLeads->where('vin', $listing['vin'])->each(function ($lead) use ($listing) {
                $lead->additional_data = $listing;
            });
        }

        $paginator = new LengthAwarePaginator(
            $filteredLeads->forPage(0, 30)->values(),
            $filteredLeads->count(),
            5,
            1,
            ['path' => $request->url(), 'query' => $request->query()]
        );
        return view('template.dealers.dashboard', compact('vehiclecount','visitCount','totalCount','paginator','mainDealer'));
    }

     /**
     * Display the dashboard for the authenticated user.
     *
     * @return \Illuminate\Contracts\View\View
     */
    public function profile(): View
    {
        $user = Auth::guard('dealer')->user();
        //$mainDealer = app('mainDealer');
        return view('template.dealers.profile', compact('user'));
    }

    public function requestInfo(){
        return view('template.dealers.request-info');
    }

    /**
     * Update the profile of the authenticated user.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return \Illuminate\Http\Response
     */
    public function updateProfile(Request $request)
    {
        $user = Auth::guard('dealer')->user();
        $id = $user->id;
        $data = $request->all();
        if (!empty($data['source']) && !preg_match('/^https?:\/\//i', $data['source'])) {
            $request->source = preg_replace('/^www\./', '', $request->source);
            $request->source =   $data['source'] = 'https://' . $data['source'];
        }

       
        $validator = Validator::make( $data, [
            
            'name' => 'required|string|max:255',
            
            //'dealership_name'=>'required|string|max:255',
            //'dealership_group'=>'required|string|max:255',
            'phone_number' => [
                'required',
                
                'numeric',
                'digits:10',
                Rule::unique('dealers')->ignore(Auth::id()),
            ],
           
            'email' => [
                'bail',
                'required',
                'email',
                function ($attribute, $value, $fail) use ($request, $id) {
                   
                    $query = \App\Models\Dealer::where('email', $value)  ;                        
                    if ($id) {
                        $query->where('id', '!=', $id);
                    }
                    if ($query->exists()) {
                        $fail('The ' . $attribute . ' is already registered with a verified dealer.');
                    }
                },
            ],
           
            
        ]);
        if ($validator -> fails()){
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,200);   
        }
        $validatedData =$request->all();
        $user = Auth::guard('dealer')->user();
        $user->name = $validatedData['name'];
        //$user->dealership_name = $validatedData['dealership_name'];
       // $user->dealership_group = $validatedData['dealership_group'];
        $user->phone_number = $validatedData['phone_number'];
       // $user->designation = $validatedData['designation'];
        
        $resend=0;
      
        if($user->email != $request->email) {
            $user->email_verified_at = null;
            $resend =1;
         
        }
        
       
        if ($request->has('phone_number')) {
            $user->phone_number = $validatedData['phone_number'];
        }
        if ($request->has('email')) {
            $user->email = $validatedData['email'];
        }
        if ($request->has('adfemail')) {
           
            $user->adfemail = $request->adfemail;
        }
       
        
        
        $user->save();
        //$this->createAdminRole($user);
        if($resend){
            $user->sendEmailVerificationNotification();
        }
        return $this->respondWithSuccess('Profile updated successfully!',$user,200);
    }

    public function createAdminRole($dealer){
        $role = Role::create([
            'name' =>'admin_'. $dealer->id,
            'guard_name' => 'dealer',
            'dealer_id' => $dealer->id,
        ]);
        $permissions = [
            'manage employee',
            'manage role',
            'manage store',
            'manage subscription',
            'view lead',
            'View Store Vehicles',
            'manage payment',
            'View Analytics'
        ];
        $role->givePermissionTo($permissions);
    }

    public function sendVerification()
    {
        $dealer = Auth::guard('dealer')->user();

        // Ensure the dealer exists and is not already verified
        if ($dealer && !$dealer->hasVerifiedEmail()) {
            $dealer->sendEmailVerificationNotification();

            // Redirect to the dealer profile page with a success message
            return redirect()->route('dealer.profile')->with('success', 'Verification email sent successfully. Please check your email to verify your account.');
        }

        // Redirect back if the dealer is already verified or no dealer found
        return redirect()->route('dealer.profile')->with('error', 'No action needed or already verified.');
    }



 
    /**
     * Update the profile of the authenticated user.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return \Illuminate\Http\Response
     */
    public function updateAddress(Request $request)
    {
        $validator = Validator::make($request->all(), [
            
            'address' => 'required|string',
            'zip_code' => 'required',
            'city' => 'required',
            'city' => 'required',
        ]);
        if ($validator -> fails()){
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,200);   
        }
        $validatedData =$request->all();
        $user = Auth::guard('dealer')->user();
        $user->address = $validatedData['address'];
        $user->address2 = $validatedData['address2'];
        $user->city = $validatedData['city'];
        $user->zip_code = $validatedData['zip_code'];
        $user->state = $validatedData['state'];
        $user->country = $validatedData['country'];
        $user->latitude = $validatedData['latitude'];
        $user->longitude = $validatedData['longitude'];
       
        $user->save();
        return $this->respondWithSuccess('Address updated successfully!',$user,200);
    }

     /**
     * Update the profile of the authenticated user.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return \Illuminate\Http\Response
     */
    public function updateProfilepic(Request $request)
    {
        $validator = Validator::make($request->all(), [
            
            
            'profile_pic' => 'required|image|max:2048',
           
            
        ]);
        if ($validator -> fails()){
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,200);   
        }
        $validatedData =$request->all();
        $user = Auth::guard('dealer')->user();
       
        if ($request->hasFile('profile_pic')) {
            $file = $request->file('profile_pic');
            $path = $file->store('profile_pics', 's3'); // Store the file in the 'profile_pics' directory on S3
    
            // Update the user's profile picture URL
            $user->profile_pic = Storage::disk('s3')->url($path);
           
        }
        
        $user->save();
        return $this->respondWithSuccess('Profile updated successfully!',$user,200);
    }

    public function myvehicle(Request $request)
    {
        $input = $request->all();
        $dealer = Auth::guard('dealer')->user();
        $params = $input;
        //$dealer->source ='willmarcars.com';

        $storeList = app('storeList');
        $parentId = app('parentId');
        if(isset($request['source']) && !empty(($request['source'])  && $request['source'] !='All'))
        {   $allstore =[$request['source']];
            $stores = $request['source'];
            $params = ['rows'=>10,'start'=>0,'source'=>$request['source']];
        }else{
            $allstore = $storeList->pluck('source')->toArray();
            $stores = implode(',',$allstore);
            $params = ['rows'=>10,'start'=>0,'source'=>$stores];
        }

        if($allstore){
          
            if(isset($input['search']) && !empty($input['search'])){
               $params[$input['keywordterm']] =$input['search'];
            }
            $params[] = array_filter($params) ;
            $params['start'] =(isset($input['page'])?($input['page']*30 -30):0) ;
            $params['rows'] =30;
            
            $vehiclelist = $this->marketcheckApiClient->getDealerSource($params);
            if(!isset($vehiclelist['listings'])){
                $vehiclelist['listings'] =[];
                $vehiclelist['num_found'] =0;
            }
        }else{
            $vehiclelist['listings'] =[];
            $params['start'] =(isset($input['page'])?($input['page']*30 -30):0) ;
            $vehiclelist['num_found'] =0;
        }
        $lead =Lead::select('vid', 'vin')
        ->selectRaw('COUNT(vin) as vin_count')
        ->whereIn('dealer_source',$allstore )
        ->groupBy('vid', 'vin')->get();

        $call =clickCallSms::select('vid', 'vin')
        ->selectRaw('COUNT(vin) as vin_count')
        ->whereIn('source',$allstore )
        ->where('type','call' )
        ->groupBy('vid', 'vin')->get();

        $sms =clickCallSms::select('vid', 'vin')
        ->selectRaw('COUNT(vin) as vin_count')
        ->whereIn('source',$allstore )
        ->where('type','sms' )
        ->groupBy('vid', 'vin')->get();

        $storedvehiclecount =[];
        $storedcallvehiclecount =[];
        $storedsmsvehiclecount =[];
        foreach($lead as $key =>$value){
            $storedvehiclecount[$value['vin']]= $value['vin_count'];
        }
        foreach($sms as $key =>$value){
            $storedsmsvehiclecount [$value['vin']]= $value['vin_count'];
        }
        foreach($call as $key =>$value){
            $storedcallvehiclecount[$value['vin']]= $value['vin_count'];
        }

        $leadvisit =Visit::select('vid', 'vin')
        ->selectRaw('COUNT(vin) as vin_count')
        ->whereIn('source',$allstore )
        ->groupBy('vid', 'vin')->get();
        $visitvehicleCount =[];
        foreach($leadvisit as $key =>$value){
            $visitvehicleCount[$value['vin']]= $value['vin_count'];
        }
        //dd($storedvehiclecount);

        foreach($vehiclelist['listings'] as $key =>$value){
           // if($value['vin'] $)
        }
        $paginator = new LengthAwarePaginator(
            $vehiclelist['listings'],
            $vehiclelist['num_found'],
            30,
            $params['start']*30,
            ['path' => request()->url(), 'query' => request()->query()]
        );
       

        //foreach($)
        #dd($ve hiclelist);
        return view('template.dealers.my-vehicles', compact('paginator','input','storedvehiclecount','visitvehicleCount','storedcallvehiclecount','storedsmsvehiclecount'));
    }

    public function getLead(){

    }


    public function myleadCar(Request $request)
    {
        $input = $request->all();
        $dealer = Auth::guard('dealer')->user();
        $params = $input;
        //$dealer->source ='willmarcars.com';
        $storeList = app('storeList');
        $parentId = app('parentId');
        if(isset($request['source']) && (!empty($request['source'])  && $request['source'] !='All'))
        {   $allstore =[$request['source']];
            $stores = $request['source'];
            $params = ['rows'=>10,'start'=>0,'source'=>$request['source']];
        }else{
            $allstore = $storeList->pluck('source')->toArray();
            $stores = implode(',',$allstore);
            $params = ['rows'=>10,'start'=>0,'source'=>$stores];
        }

        if($allstore){

            $lead =Lead::select('vid', 'vin')
            ->selectRaw('COUNT(vin) as vin_count')
            ->whereIn('dealer_source', $allstore  )
            ->groupBy('vid', 'vin')
            ->paginate(30);
            $vin_array =[];
            $myvin =[];
            foreach($lead  as $item){
                $vin_array[$item->vin] = $item->vin_count;
                $myvin[] = $item->vin;
            }
            if($myvin){

            
                $vinlist = implode(',',$myvin);
                $params['start'] =(isset($input['page'])?($input['page']*30 -30):0) ;
                $params = ['rows'=>0,'start'=>0,'source'=>$dealer->source];
                if(isset($input['search']) && !empty($input['search'])){
                    $params[$input['keywordterm']] =$input['search'];
                }
                $params['rows'] =30;
                $params['vin'] = $vinlist;
                $vehiclelist = $this->marketcheckApiClient->searchActiveCars($params);
            }else{
                $vehiclelist['listings'] =[];
                $vehiclelist['num_found'] =0;
            }
            
        }else{
                $vehiclelist['listings'] =[];
                $vehiclelist['num_found'] =0;
            }
        $paginator = new LengthAwarePaginator(
            $vehiclelist['listings'],
            $vehiclelist['num_found'],
            30,
            (isset($input['page'])?($input['page']*30 -30):0),
            ['path' => request()->url(), 'query' => request()->query()]
        );
       
        return view('template.dealers.request-info', compact('paginator','input','vin_array'));
    }

    public function carDetail(Request $request){
        $vin_id = $request->id;
        $vehicle = $this->marketcheckApiClient->getListing($vin_id);
        $params['vin'] = $vehicle['vin'];
        $params['match'] ='year,make,model,trim';
        $params['stats'] ='price,miles,dom';
        $similiarcar = $this->marketcheckApiClient->searchActiveCars($params);
        $organized_features = [];
        if(isset($vehicle['extra']['high_value_features'])){
            foreach ($vehicle['extra']['high_value_features'] as $feature) {
                $category = $feature['category'];
                $description = $feature['description'];
                // Initialize category array if it doesn't exist
                if (!isset($organized_features[$category])) {
                    $organized_features[$category] = [];
                }
                // Append the description to the category array
                $organized_features[$category][] = $description;
            }
        }
        $html = view('template.dealers.car', compact('vehicle','similiarcar','organized_features'))->render();
        return response()->json(['html' => $html]);
       
    }

    public function leadDetail(Request $request){
        $dealer = Auth::guard('dealer')->user();
        $lead = Lead::with('user')->where('id', $request->id)->first();
        $subscription = $dealer->subscription('default');
        $user = $lead->user;
        $vin_id = $lead->vin;
        $vehicle = $this->marketcheckApiClient->getListing($vin_id);
        //dd($subscription);
        $html = view('template.dealers.leadDetail', compact('lead','user','vehicle','subscription'))->render();
        
        return response()->json(['html' => $html,'viewed'=>$lead->viewed]);
       
    }



    public function mylead(Request $request)
    {
       
        $input = $request->all();
        $dealer = Auth::guard('dealer')->user();
       
        $input['dealer_id'] = $dealer->id;
        $data = Lead::query()->makeQuery($input)->paginate(10);
    
        $data->appends($request->except('page'));

        return view('template.dealers.request-info', [
            'vehicles' => $data,
            'input' => $input,
        ]);
    }


  

    public function myBooking(Request $request)
    {
       
        $input = $request->all();
        $dealer = Auth::guard('dealer')->user();
       
        $input['dealer_id'] = $dealer->id;
        
        // Build query with source filtering
        $query = Booking::query()->makeQuery($input);
        
        // Apply source filter if provided
        if ($request->filled('source')) {
            $source = $request->get('source');
            if ($source === 'facebook_messenger') {
                $query->whereHas('tracking', function($q) use ($source) {
                    $q->where('utm_source', $source);
                });
            } elseif ($source === 'website') {
                $query->whereHas('tracking', function($q) use ($source) {
                    $q->where('utm_source', $source);
                });
            } elseif ($source === 'direct') {
                $query->whereDoesntHave('tracking');
            }
        }
        
        // Apply search filter if provided
        if ($request->filled('search')) {
            $search = $request->get('search');
            $query->where(function($q) use ($search) {
                $q->where('name', 'like', '%' . $search . '%')
                  ->orWhere('email', 'like', '%' . $search . '%')
                  ->orWhere('phone', 'like', '%' . $search . '%');
            });
        }
        
        $data = $query->with('tracking')->paginate(10);
    
        $data->appends($request->except('page'));

        // Enhance booking data with tracking information
        $enhancedData = $data->getCollection()->map(function ($booking) {
            // Get tracking data for this booking
            $tracking = $booking->tracking;
            
            // Enhance the booking object with tracking data
            $booking->tracking_data = $tracking ? $tracking->toArray() : null;
            $booking->utm_source = $tracking ? $tracking->utm_source : null;
            $booking->vehicle_id = $tracking ? $tracking->vehicle_id : null;
            $booking->vehicle_title = $tracking ? $tracking->vehicle_title : null;
            $booking->conversation_id = $tracking ? $tracking->conversation_id : null;
            
            return $booking;
        });

        // Replace the collection with enhanced data
        $data->setCollection($enhancedData);

        // Get analytics data for the dashboard
        $analytics = $this->getBookingAnalytics($dealer->id, $input);

        return view('template.dealers.booking', [
            'vehicles' => $data,
            'input' => $input,
            'totalBookings' => $analytics['total_bookings'],
            'conversionRate' => $analytics['conversion_rate'],
            'facebookVisits' => $analytics['facebook_visits'],
            'thisMonthBookings' => $analytics['this_month_bookings']
        ]);
    }

    /**
     * Get booking analytics for the dealer
     */
    private function getBookingAnalytics($dealerId, $filters = [])
    {
        // Total bookings
        $totalBookings = \App\Models\Booking::where('dealer_id', $dealerId)->count();
        
        // Facebook visits (from tracking)
        $facebookVisits = \App\Models\FacebookBookingTracking::where('dealer_id', $dealerId)
            ->where('source_type', 'facebook_messenger')
            ->count();
        
        // This month bookings
        $thisMonthBookings = \App\Models\Booking::where('dealer_id', $dealerId)
            ->whereMonth('created_at', now()->month)
            ->whereYear('created_at', now()->year)
            ->count();
        
        // Conversion rate (bookings from Facebook / total Facebook visits)
        $facebookBookings = \App\Models\FacebookBookingTracking::where('dealer_id', $dealerId)
            ->where('source_type', 'facebook_messenger')
            ->where('status', 'converted')
            ->count();
        
        $conversionRate = $facebookVisits > 0 ? round(($facebookBookings / $facebookVisits) * 100, 1) : 0;
        
        return [
            'total_bookings' => $totalBookings,
            'conversion_rate' => $conversionRate,
            'facebook_visits' => $facebookVisits,
            'this_month_bookings' => $thisMonthBookings
        ];
    }
    
    /**
     * Logout the authenticated user.
     *
     * @return \Illuminate\Http\RedirectResponse
     */
    public function logout()
    {
        Auth::guard('dealer')->logout(); 
        return redirect()->route('dealer.index'); 
    }

    public function lead()
    {
        Auth::guard('dealer')->logout(); 
        return redirect()->route('dealer.index'); 
    }

    public function bookingDownload(Request $request){

         $input = $request->all();
        $dealer = Auth::guard('dealer')->user();
        $input['dealer_id'] = $dealer->id;
        
        // Build query with same filtering as myBooking
        $query = Booking::query()->makeQuery($input);
        
        // Apply source filter if provided
        if ($request->filled('source')) {
            $source = $request->get('source');
            if ($source === 'facebook_messenger') {
                $query->whereHas('tracking', function($q) use ($source) {
                    $q->where('utm_source', $source);
                });
            } elseif ($source === 'website') {
                $query->whereHas('tracking', function($q) use ($source) {
                    $q->where('utm_source', $source);
                });
            } elseif ($source === 'direct') {
                $query->whereDoesntHave('tracking');
            }
        }
        
        // Apply search filter if provided
        if ($request->filled('search')) {
            $search = $request->get('search');
            $query->where(function($q) use ($search) {
                $q->where('name', 'like', '%' . $search . '%')
                  ->orWhere('email', 'like', '%' . $search . '%')
                  ->orWhere('phone', 'like', '%' . $search . '%');
            });
        }

        $leads = $query->with('tracking')->get();

        // Define the CSV headers
        $headers = [
            'Content-Type' => 'text/csv',
            'Content-Disposition' => 'attachment; filename="leads.csv"',
        ];

        // Define the columns you want to export
        $columns = [
            'ID', 'User Name', 'Phone','Email', 'Booking Date', 'Booking Time', 'Source', 'Vehicle ID', 'Vehicle Title', 'Conversation ID', 'Create AT'
        ];

        // Create a callback function to generate the CSV
        $callback = function() use ($leads, $columns) {
            $file = fopen('php://output', 'w');
            fputcsv($file, $columns);

            foreach ($leads as $lead) {
                // Get tracking data
                $tracking = $lead->tracking;
                
                $data = [
                    $lead->id,
                    $lead->name,
                    $lead->phone,
                    $lead->email,
                    $lead->booking_date,
                    $lead->booking_time,
                    $tracking ? $tracking->utm_source : 'Direct',
                    $tracking ? $tracking->vehicle_id : 'N/A',
                    $tracking ? $tracking->vehicle_title : 'N/A',
                    $tracking ? $tracking->conversation_id : 'N/A',
                    $lead->created_at->format('Y-m-d H:i:s')
                ];
                fputcsv($file, $data);
            }

            fclose($file);
        };

        return streamreponse::stream($callback, 200, $headers);
    }

    /**
     * Export tracking data for bookings
     */
    public function exportTrackingData(Request $request)
    {
        $input = $request->all();
        $dealer = Auth::guard('dealer')->user();
        $input['dealer_id'] = $dealer->id;
        
        // Get tracking data
        $trackingData = FacebookBookingTracking::where('dealer_id', $dealer->id)
            ->with(['booking', 'user'])
            ->get();

        $filename = "tracking_data_" . date('Y-m-d_H-i-s') . ".csv";
        
        $headers = [
            'Content-Type' => 'text/csv',
            'Content-Disposition' => "attachment; filename=\"$filename\"",
        ];

        $columns = [
            'Tracking ID', 'Dealer ID', 'User ID', 'Conversation ID', 'Vehicle ID',
            'Vehicle Title', 'UTM Source', 'Source Type', 'Page ID', 'Sender ID',
            'Session ID', 'Visit Date', 'Converted Date', 'Status', 'Customer Name',
            'Customer Email', 'Customer Phone', 'Booking Date', 'Booking Time'
        ];

        $callback = function() use ($trackingData, $columns) {
            $file = fopen('php://output', 'w');
            fputcsv($file, $columns);

            foreach ($trackingData as $tracking) {
                $data = [
                    $tracking->id,
                    $tracking->dealer_id,
                    $tracking->user_id,
                    $tracking->conversation_id,
                    $tracking->vehicle_id,
                    $tracking->vehicle_title,
                    $tracking->utm_source,
                    $tracking->source_type,
                    $tracking->page_id,
                    $tracking->sender_id,
                    $tracking->session_id,
                    $tracking->visited_at,
                    $tracking->converted_at,
                    $tracking->status,
                    $tracking->booking ? $tracking->booking->name : 'N/A',
                    $tracking->booking ? $tracking->booking->email : 'N/A',
                    $tracking->booking ? $tracking->booking->phone : 'N/A',
                    $tracking->booking ? $tracking->booking->booking_date : 'N/A',
                    $tracking->booking ? $tracking->booking->booking_time : 'N/A'
                ];
                fputcsv($file, $data);
            }

            fclose($file);
        };

        return streamreponse::stream($callback, 200, $headers);
    }

    public function leadDownload(Request $request){
        // Get the filtered data
        $input = $request->all();
        $dealer = Auth::guard('dealer')->user();
        $input['dealer_id'] = $dealer->id;
        $query = Lead::query()->makeQuery($input);
    

        $leads = $query->get();

        // Define the CSV headers
        $headers = [
            'Content-Type' => 'text/csv',
            'Content-Disposition' => 'attachment; filename="leads.csv"',
        ];

        // Define the columns you want to export
        $columns = [
            'ID', 'VIN', 'User Name', 'Phone','Email', 'Dealer Name', 'Dealer Phone', 'Website', 'Date'
        ];

        // Create a callback function to generate the CSV
        $callback = function() use ($leads, $columns) {
            $file = fopen('php://output', 'w');
            fputcsv($file, $columns);

            foreach ($leads as $lead) {
                $data = [
                    $lead->id,
                    $lead->vin,
                    $lead->user->name,
                  
                    $lead->user->phone_number,
                    $lead->user->email,
                    $lead->dealer ? $lead->dealer->name : '',
                    $lead->dealer ? $lead->dealer->phone_number : '',
                    $lead->dealer ? $lead->dealer->storelist->source : '',
                    $lead->created_at->format('Y-m-d H:i:s')
                ];
                fputcsv($file, $data);
            }

            fclose($file);
        };

        return streamreponse::stream($callback, 200, $headers);

    }
}
