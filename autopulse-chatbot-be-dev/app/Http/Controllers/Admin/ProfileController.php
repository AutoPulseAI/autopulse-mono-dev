<?php
namespace App\Http\Controllers\Admin;
 
use App\Models\Admin;
use Illuminate\View\View;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Session;

use Illuminate\Support\Str;
use App\Services\SnsService;
use App\Services\AuthService;
use App\Http\Traits\ApiResponseTrait;
use  Illuminate\Http\Response;
use Validator;
use Illuminate\Validation\Rule;
use Illuminate\Support\Facades\Storage;
use App\Http\Controllers\Controller;
use Illuminate\Validation\Rules\Password;
use App\Models\User;
use App\Models\Dealer;
use App\Models\Lead;
use App\Models\ConversionClick;
use App\Models\Conversation;
 
class ProfileController extends Controller
{
    use ApiResponseTrait;
    /**
     * Display the dashboard for the authenticated user.
     *
     * @return \Illuminate\Contracts\View\View
     */
    public function index(): View
    {
        // Retrieve the authenticated user
        $user = Auth::guard('admin')->user();

        // Check if the user has the 'seo' role
       
        $users = User::count();
        $dealer = Dealer::count();
        $demo =0;
        $lead = Lead::count();
        $view_vehicle_count = ConversionClick::where('action','View_Vehicle')->count();
        $visit_dealer_website_count = ConversionClick::where('action','Visit_dealer_website')->count();
        $vin_Reqeust_form_count = ConversionClick::where('action','Vin_Reqeust_form')->count();
        $explore_more_count = ConversionClick::where('action','Explore_more')->count();
        $vin_copy_count = ConversionClick::where('action','vin_copy')->count();
        $conversation_count = Conversation::whereRaw("JSON_UNQUOTE(JSON_EXTRACT(request, '$.dealership_name')) != ?", ['autopulse.ai'])->count();

        $totalSessionTime = Conversation::whereRaw("JSON_UNQUOTE(JSON_EXTRACT(request, '$.dealership_name')) != ?", ['autopulse.ai'])
        ->sum('time_diff');
        // Return the dashboard view with the authenticated user data
        return view('template.admin.dashboard', compact('users','demo','dealer','lead','view_vehicle_count',
        'visit_dealer_website_count','vin_Reqeust_form_count','explore_more_count','vin_copy_count','conversation_count','totalSessionTime'));
    }

    public function userlist(Request $request)
    {

        if(isset($export) && !empty($export)){
            $user = User::query();

        }elseif(isset($from) || isset($to)){
            $user = User::query();
            if(!empty($from)&&!empty($to)){
                $user =  $user ->whereDate('created_at','>=',$from)
                    ->whereDate('created_at','<=',$to);
            }
            elseif(!empty($from)&&empty($to)){
                $user = $user ->whereDate('created_at','>=',$start_date);;
            }
            elseif(empty($from)&&!empty($to)){
                $user =  $user ->whereDate('created_at','<=',$to);
            }
            $user = $user->get()->all();
        }else{
            $user = User::all();
        }
       
        return view('template.admin.userlist',compact('user'));
    }

    public function userlist_edit($id)
    {
        $user = User::find($id);
        return response()->json($user);
    }

    public function userlist_tableData(Request $request)
    {
        $request->merge(['page' => (($request->input('start')/ $request->input('length'))+1)]);
        $request->merge(['perPage' => $request->input('length')]);
      
        $this->perPage = $request->input('length', 3);
        $input= $request->all(); 

        $export = $request->get('export');
        $from = $request->get('from');
        $to = $request->get('to');
      
        $data = User::query()->makeQuery($input)->paginate(  $this->perPage );
          
        return  response()->json([
            'data' => $data->items(),
            'draw' => $request->input('draw'), // Add draw parameter for security (optional)
            'recordsTotal' => $data->total(),
            'recordsFiltered' => $data->total(),
        ]);
    }

    public function log(){
        return view('template.admin.log');
    }

    
   
   

   
    public function profile(): View
    {
        // Retrieve the authenticated user
        $user = Auth::guard('admin')->user();

        // Return the profile view with the authenticated user data
        return view('template.admin.profile', compact('user'));
    }

    /**
     * Update the profile of the authenticated user.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return \Illuminate\Http\Response
     */
    public function updateProfile(Request $request)
    {
        $validator = Validator::make($request->all(), [
            
            'name' => 'required|string|max:255',
            
            'profile_pic' => 'nullable|image|max:2048',
            'email' => [
                'required',
                'email',
                Rule::unique('admin')->ignore(Auth::id()),
            ],

        ]);

        if ($validator->fails()){
            $errors = $validator -> errors();
            //return $this->respondWithError('errors',$errors ,Response::HTTP_OK); 
            return redirect()->back()->withErrors($validator); 
        }

        $validatedData =$request->all();
        $user = Auth::user();
        $user->name = $validatedData['name'];
        
        $user->email = $validatedData['email'];
  
        if ($request->hasFile('profile_pic')) {
            $file = $request->file('profile_pic');
            $path = $file->store('profile_pics', 's3'); // Store the file in the 'profile_pics' directory on S3
    
            // Update the user's profile picture URL
            $user->profile_pic = Storage::disk('s3')->url($path);
           
        }
        
        $user->save();

        return redirect()->route('admin.profile')->with('profile', __('Profile Updated Successfully'));
    }

    public function updatePassword(Request $request)
    {
        
            $user = Auth::user();

            $validator = Validator::make($request->all(), [
                'current_password' => ['required', function ($attribute, $value, $fail) use ($user) {
                    if (!\Hash::check($value, $user->password)) {
                        return $fail(__('The current password is incorrect.'));
                    }
                }],
                'new_password' => ['required', 'min:8' , function ($attribute, $value, $fail) use ($user) {
                    if (\Hash::check($value, $user->password)) {
                        return $fail(__('New Password cannot be same as your current password.'));
                    }
                }],
                'confirm_password' => 'required|min:8|required_with:new_password|same:new_password',
            ]);

            if ($validator->fails()){
                $errors = $validator -> errors();
                //return $this->respondWithError('errors',$errors ,Response::HTTP_OK); 
                return redirect()->back()->withErrors($validator); 
            }

            $user->password =  Hash::make($request->new_password);
            $user->save();
            return back()->with('password', "Password Changed Successfully");
        }

    /**
     * Logout the authenticated user.
     *
     * @return \Illuminate\Http\RedirectResponse
     */
    public function logout()
    {
        Auth::guard('admin')->logout(); 
        return redirect()->route('admin.login'); 
    }
}
