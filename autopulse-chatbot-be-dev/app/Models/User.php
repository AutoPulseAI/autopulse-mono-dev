<?php

namespace App\Models;
use App\Notifications\UserVerifyEmail;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use DB;
use App\Notifications\UserResetPasswordNotification;

class User extends Authenticatable implements MustVerifyEmail
{
    use HasFactory,  Notifiable;

    /**
     * The attributes that are mass assignable.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'phone_number',
        'dial_code',
        'name',
      
        'email',
        'city',
        'state',
        'address',
        'zip_code',
        'address2',
        'latitude',
        'longitude',
        'password',
        'social_account',
        'email_verified_at',
        'messenger_page_id', 'messenger_psid',

       
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

    public function sendEmailVerificationNotification()
    {
        $this->notify(new UserVerifyEmail);
    }

    public function getEmailVerificationUrlAttribute()
    {
        return URL::temporarySignedRoute(
            'verification.userverify', // The route name that handles verification
            now()->addMinutes(60), // Link expiration time
            [
                'id' => $this->getKey(), // Dealer ID
                'hash' => sha1($this->getEmailForVerification()), // Hash of the email
            ]
        );
    }

    public function sendPasswordResetNotification($token)
    {
        $this->notify(new UserResetPasswordNotification($token));
    }

    public function socialAccounts(){
        return $this->hasMany(socialAccount::class,'user_id','id');
    }


    public function scopeMakeQuery($query, $data)
    {

        $model = $this->query();
       
        if($this->checkExistinArray('id',$data))  $model = $model->where('id',$data['id']);
        if ($this->checkExistinArray('search', $data)) {
            $searchValue = $data['search']['value'];
          
            if($searchValue){
                
                $model = $model->where(function ($query) use ($searchValue) {
                    $query->where('name', 'like', '%' . $searchValue . '%')
                 
                    ->orWhere('email', 'like', '%' . $searchValue . '%')
                    ->orWhere('phone_number', 'like', '%' . $searchValue . '%')
                    ->orWhere('city', 'like', '%' . $searchValue . '%')
                    ->orWhere('state', 'like', '%' . $searchValue . '%')
                    ->orWhere('address', 'like', '%' . $searchValue . '%')
                    ->orWhere('zip_code', 'like', '%' . $searchValue . '%')
                    ->orWhere('created_at', 'like', '%' . $searchValue . '%');   
                });

            }
        }
    
        if ($this->checkExistinArray('order', $data)) {
            $orderColumn = $data['order'][0]['column'];
            $orderDirection = $data['order'][0]['dir'];
    
            $orderColumns = ['id', 'name', 'email', 'phone_number', 'city', 'state', 'address', 'zip_code', 'created_at'];
    
            $orderBy = isset($orderColumns[$orderColumn]) ? $orderColumns[$orderColumn] : 'id';
    
            $model = $model->orderBy($orderBy, $orderDirection);
        }else{
            $model = $model->orderBy('id', 'desc');
        }
       
        return $model;
    }

    public function checkExistinArray($key,$data,$dafault=false)
    {
       return  isset($data[$key]) && $data[$key]!=''?true:$dafault;
    }
}
