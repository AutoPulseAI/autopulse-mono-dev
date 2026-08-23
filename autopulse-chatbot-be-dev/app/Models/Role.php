<?php 
namespace App\Models;

use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role as SpatieRole;



class Role extends SpatieRole
{
    //use HasRoles;

    protected $fillable = [
        'name', 'guard_name', 'dealer_id'
    ];
    
    public function dealer()
    {
        return $this->belongsTo(Dealer::class);
    }

    public function hasManageStorePermission()
    {
        return $this->permissions()->where('name', 'manage store')->exists();
    }

    public function scopeMakeQuery($query, $data)
    {
        $model = $query->with('permissions')->where('name', '!=', 'admin');
       
        if ($this->checkExistInArray('id', $data)) {
            $model = $model->where('id', $data['id']);
        }
        if ($this->checkExistInArray('guard', $data)) {
            $model = $model->where('guard_name', $data['guard']);
        }
        if ($this->checkExistInArray('search', $data)) {
            $searchValue = $data['search']['value'];
            if ($searchValue) {
                $model = $model->where(function ($query) use ($searchValue) {
                    $query->where('name', 'like', '%' . $searchValue . '%')
                          ->orWhere('created_at', 'like', '%' . $searchValue . '%');
                });
            }
        }
    
        if ($this->checkExistInArray('order', $data)) {
            $orderColumn = $data['order'][0]['column'];
            $orderDirection = $data['order'][0]['dir'];
    
            $orderColumns = ['id', 'name']; // Assuming 'role_name' is 'name'
            $orderBy = isset($orderColumns[$orderColumn]) ? $orderColumns[$orderColumn] : 'id';
    
            $model = $model->orderBy($orderBy, $orderDirection);
        } else {
            $model = $model->orderBy('id', 'desc');
        }
       
        return $model;
    }

    public function checkExistInArray($key, $data, $default = false)
    {
        return isset($data[$key]) && $data[$key] != '' ? true : $default;
    }
}
