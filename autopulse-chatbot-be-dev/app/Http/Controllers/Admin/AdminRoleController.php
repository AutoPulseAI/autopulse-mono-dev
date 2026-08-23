<?php
 
namespace App\Http\Controllers\Admin;
 
use App\Models\Role;

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
use Spatie\Permission\Models\Permission;

class AdminRoleController extends Controller
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
    public function role(Request $request): View
    {
        // Retrieve the authenticated user
        $roles = Role::where('guard_name' , 'admin')->get();;
        $permissions = Permission::where('guard_name','admin')->get();
      
        return view('template.admin.role',compact('roles','permissions'));
    }
     /**
     * update the add role 
     *
     * @return \Illuminate\Contracts\View\View
    */

    public function roleData(Request $request)
    {
        $request->merge(['page' => (($request->input('start')/ $request->input('length'))+1)]);
        $request->merge(['perPage' => $request->input('length')]);
      
        $this->perPage = $request->input('length', 3);
        $input= $request->all(); 
      
        $query = Role::makeQuery($input)->paginate($this->perPage);
        $data = $query->map(function ($role) {
            $role->permissions_list = $role->permissions->pluck('name')->implode(', ');
            return $role;
        });
        return response()->json([
            'data' => $data,
            'draw' => $request->input('draw'), // Add draw parameter for security (optional)
            'recordsTotal' => $query->total(),
            'recordsFiltered' => $query->total(),
        ]);
    }

    public function getData(Request $request)
    {
       
        $input= $request->all(); 
        
        $data = Role::query()->makeQuery($input)->paginate( $this->perPage );
          
        return $this->respondWithSuccess('Role registered successfully. ', $data, Response::HTTP_OK);
    }


    public function addadminRole(Request $request)
    {
       
     
        $validator = Validator::make($request->all(), [
            'role_name' => 'required|string|max:255',
           
            'permissions' => 'required|array',
            'permissions.*' => 'exists:permissions,name',
        ]);
    
        // Custom validation to check if role already exists for dealer guard
        $validator->after(function ($validator) use ($request) {
            if (Role::where('name', $request->role_name)
                    ->where('guard_name', 'admin')
                   
                    ->exists()) {
                $validator->errors()->add('role_name', 'A role with this name already exists for the admin.');
            }
        });
    
        if ($validator->fails()) {
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK); 
        }
    
     
        $role = Role::create([
            'name' => $request->role_name,
            'guard_name' => 'admin',
          
        ]);
        $role->syncPermissions($request->permissions);

        return $this->respondWithSuccess('Role registered successfully. ', [$role], Response::HTTP_OK);
    }

    public function updateRole(Request $request)
    {
      
        $validator = Validator::make($request->all(), [
            'role_id' => 'required|exists:roles,id',
            'role_name' => 'required|string|max:255',
            'permissions' => 'required|array',
            //'permissions.*' => 'exists:permissions,name',
        ]);

        $validator->after(function ($validator) use ($request) {
            if (Role::where('name', $request->role_name)
                    ->where('guard_name', 'admin')
                
                    ->exists()) {
                $validator->errors()->add('role_name', 'A role with this name already exists for the dealer.');
            }
        });

        $role = Role::find($request->role_id);
        $role->name = $request->role_name;
        $role->save();

        $role->syncPermissions($request->permissions);

        return $this->respondWithSuccess('Role Updated successfully. ', [$role], Response::HTTP_OK);
    }

    public function deleteRole(Request $request)
    {
        try{
            $validator = Validator::make($request->all(), [
                'role_id'=>'required|exists:roles,id',
            ]);
            if ($validator -> fails()){
                $errors = $validator -> errors();
                return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);
            }
            $page = Role::where('id',$request->role_id)->first()->delete();
            return $this->respondWithSuccess(__( 'Role Deleted Successfully' ), $page,Response::HTTP_OK);
        } catch (\Exception $e){
            DB::rollback();
            return $this->respondWithError('Something Went Wrong !',$e->getMessage(),Response::HTTP_INTERNAL_SERVER_ERROR);
        } 
    }
}

