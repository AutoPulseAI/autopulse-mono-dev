<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use App\Models\FacebookBookingTracking;


class Booking extends Model
{
    use HasFactory;
    protected $table = 'bookings';
    protected $fillable = [
        'name',
        'email',
        'conversion_id',
        'dealer_id',
        'booking_date',
        'booking_time',
        'user_id',
        'phone'
       
       
    ];

    public function dealer(){
        return $this->belongsTo(Dealer::class,'dealer_id','id');
    }
    
    public function user(){
        return $this->belongsTo(User::class,'user_id','id');
    }

    public function tracking(){
        return $this->hasOne(FacebookBookingTracking::class,'booking_id','id');
    }



    public function scopeMakeQuery($query, $data)
    {

        $model = $this->query()->with('dealer');
       
        if($this->checkExistinArray('id',$data))  $model = $model->where('id',$data['id']);
        if($this->checkExistinArray('dealer_id',$data))  $model = $model->where('dealer_id',$data['dealer_id']);
       
      
        // Handle DataTables search parameter
        if (isset($data['search'])) {
            $searchValue = $data['search'];
            
            // Handle different search formats from DataTables
            if (is_array($searchValue)) {
                // DataTables sends search as array with 'value' key
                $searchValue = $searchValue['value'] ?? '';
            }
            
            // Ensure we have a valid string to search
            if (!empty($searchValue) && is_string($searchValue)) {
                $model = $model->where(function ($query) use ($searchValue) {
                    $query->where('name', 'like', '%' . $searchValue . '%')
                        ->orWhere('email', 'like', '%' . $searchValue . '%')
                        ->orWhere('phone', 'like', '%' . $searchValue . '%');
                });
            }
        }

        if($this->checkExistinArray('from',$data))  $model = $model->where('created_at','>=',$data['from']);
        if($this->checkExistinArray('to',$data))  $model = $model->where('created_at','<=',$data['to']);
        if ($this->checkExistinArray('order', $data) && is_array($data['order']) && !empty($data['order'])) {
            $orderColumn = $data['order'][0]['column'] ?? 0;
            $orderDirection = $data['order'][0]['dir'] ?? 'asc';
    
            $orderColumns = ['id', 'name', 'email', 'phone', 'booking_date', 'booking_time', 'dealer_name', 'created_at'];
    
            $orderBy = isset($orderColumns[$orderColumn]) ? $orderColumns[$orderColumn] : 'id';
    
            $model = $model->orderBy($orderBy, $orderDirection);
        } else {
            $model = $model->orderBy('id', 'desc');
        }
        
        return $model;
       
    }

    public function checkExistinArray($key, $data, $default = false)
    {
        return isset($data[$key]) && $data[$key] !== '' && $data[$key] !== null ? true : $default;
    }
    
}
