<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Spatie\Permission\Traits\HasRoles;

class Admin extends Authenticatable
{
    use HasFactory, Notifiable;

    /**
     * The attributes that are mass assignable.
     *
     * @var array<int, string>
     */
    protected $table = 'admin';
    protected $fillable = [
        'name',
       
        'email',
        'password'
       
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var array<int, string>
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    public function managedDealers()
    {
        // Assuming a dealer can manage multiple other dealers,
        // and this relationship is stored in a 'dealer_manager' pivot table.
        return $this->hasMany(AssignAdminDealer::class, 'admin_id');
    }

    public function assingAdminDealers()
    {
        return $this->hasMany(AssignAdminDealer::class, 'admin_id');
    }

    public function scopeMakeQuery($query, $data)
    {
        $model = $this->query();
       
        if ($this->checkExistInArray('id', $data)) {
            $model = $model->where('id', $data['id']);
        }
       
        if ($this->checkExistInArray('search', $data)) {
            $searchValue = $data['search']['value'];
            if ($searchValue) {
                $model = $model->where(function ($query) use ($searchValue) {
                    $query->where('name', 'like', '%' . $searchValue . '%')
                 
                    ->orWhere('email', 'like', '%' . $searchValue . '%')
                    //->orWhere('phone', 'like', '%' . $searchValue . '%')
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
