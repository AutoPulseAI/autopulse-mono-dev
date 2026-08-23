<?php
 
namespace App\Http\Controllers\Admin;
 
use App\Models\Role;
use App\Models\Admin;
use App\Models\AssignAdminDealer;
use Illuminate\View\View;
use App\Models\Dealer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Session;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Str;

use App\Http\Traits\ApiResponseTrait;
use  Illuminate\Http\Response;
use Validator;
use Illuminate\Validation\Rule;
use Illuminate\Support\Facades\Storage;
use App\Http\Controllers\Controller;
use App\Mail\AdminResetPasswordMail;
use App\Mail\AdminAccountMail;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\DB;

class AdminEmployeeController extends Controller
{
    use ApiResponseTrait;
    /**
     * Display the dashboard for the authenticated user.
     *
     * @return \Illuminate\Contracts\View\View
     */
    /**
     * Display the  for the Add Role user.
     *
     * @return \Illuminate\Contracts\View\View
    */
    public function index(Request $request): View
    {
        // Retrieve the authenticated user
       // $roles = Role::where('guard_name' , 'admin')->get();;
        $admin = Admin::get();
        //$dealerGroup = Dealer::where('parent_id', 0)->where('dealership_group','!=' ,NULL)->get();
        return view('template.admin.staff',compact('admin'));
    }
     /**
     * update the add role 
     *
     * @return \Illuminate\Contracts\View\View
    */

    public function employeeData(Request $request)
    {
        $request->merge(['page' => (($request->input('start')/ $request->input('length'))+1)]);
        $request->merge(['perPage' => $request->input('length')]);
      
        $this->perPage = $request->input('length', 3);
        $input= $request->all(); 
      
        $data = Admin::makeQuery($input)->paginate($this->perPage);
        
        return response()->json([
            'data' =>  $data->items(),
            'draw' => $request->input('draw'), // Add draw parameter for security (optional)
            'recordsTotal' => $data->total(),
            'recordsFiltered' => $data->total(),
        ]);
    }

    


    public function storeEmployee(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string',
            
            'email' => 'required|email|unique:admin,email',
            'password' => 'required|string|min:8',
           
        ]);
        if ($validator->fails()) {
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK); 
        }

        $staff = Admin::create([
            'name' => $request['name'],
          
            'email' => $request['email'],
            'password' => Hash::make($request['password'])
        ]);
       
        Mail::to($staff->email)->send(new AdminAccountMail($staff, $request['password'],$request->role));


        return $this->respondWithSuccess('Role registered successfully. ', $staff, Response::HTTP_OK);
    }

    public function updateEmployee(Request $request)
    {
      
        $validator = Validator::make($request->all(), [
            'name' => 'required|string',
            
            'email' => 'required|string|email|max:255|unique:admin,email,' . $request->staff_id,
            
           // 'role' => 'required|exists:roles,name'
        ]);
        if ($validator->fails()) {
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK); 
        }
        $staff = Admin::findOrFail($request->staff_id);
        $staff->update($request->all());
        /*$staff->assignRole($request->role);
        if ($staff->hasRole($request->role) && $staff->hasPermissionTo('manage stores')) {
            // Detach previous dealer groups
            AssignAdminDealer::where('admin_id', $staff->id)->delete();
    
            if (!empty($request->dealerGroups)) {
                foreach ($request->dealerGroups as $dealerGroupId) {
                    AssignAdminDealer::create([
                        'admin_id' => $staff->id,
                        'dealer_id' => $dealerGroupId,
                    ]);
                }
            }
        } else {
            // If the role no longer has permission, remove any existing dealer group assignments
            AssignAdminDealer::where('admin_id', $staff->id)->delete();
        }*/

        return $this->respondWithSuccess('Role Updated successfully. ', $staff, Response::HTTP_OK);
    }

    public function deleteEmployee(Request $request)
    {
        try{
            $validator = Validator::make($request->all(), [
                'staff_id'=>'required|exists:admin,id',
            ]);
            if ($validator -> fails()){
                $errors = $validator -> errors();
                return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);
            }
            $page = Admin::where('id',$request->staff_id)->first()->delete();
            return $this->respondWithSuccess(__( 'Staff Deleted Successfully' ), $page,Response::HTTP_OK);
        } catch (\Exception $e){
            DB::rollback();
            return $this->respondWithError('Something Went Wrong !',$e->getMessage(),Response::HTTP_INTERNAL_SERVER_ERROR);
        } 
    }

    public function resetPassword(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'password' => 'required|string|min:8|confirmed',
        ]);

        // Return validation errors if any
        if ($validator->fails()) {
            $errors = $validator->errors();
            return $this->respondWithError('Validation Message', $errors, Response::HTTP_OK);
        }

        // Find the dealer and update the password
        $staff = Admin::find($request->staff_id);
       //dd($staff);
      
        $staff->update([
            'password' => Hash::make($request->password),
        ]);

        Mail::to($staff->email)->send(new AdminResetPasswordMail($staff, $request->password));

        return response()->json(['success' => true]);
    }

    public function checkRolePermission(Request $request)
    {
        $role = Role::where('name', $request->role_name)->first();
        $permission = $role->hasManageStorePermission();
        $hasPermission = $role->hasPermissionTo('manage stores');
        return response()->json([
            'hasManageStorePermission' => $hasPermission,
        ]);
    }
}

