<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ConversionBooking extends Model
{
    protected $connection = 'secondary_db';
    protected $table = 'conversion_bookings';
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

 
    public function scopeMakeQuery($query, $data)
    {

     
       
        if($this->checkExistinArray('id',$data))  $model = $model->where('id',$data['id']);
       
      
        if ($this->checkExistinArray('search', $data)) {
            $searchValue = $data['search']['value'];
          
            if($searchValue){
                
                $model = $model->where(function ($query) use ($searchValue) {
                    $query->where('name', 'like', '%' . $searchValue . '%')
                
                    ->orWhere('email', 'like', '%' . $searchValue . '%')
                    ->orWhere('dealership_group', 'like', '%' . $searchValue . '%');
                   
                });

            }
        }

        if($this->checkExistinArray('start_date',$data))  $model = $model->where('start_date','>=',$data['start_date']);
        if($this->checkExistinArray('end_date',$data))  $model = $model->where('end_date','>=',$data['end_date']);
        if ($this->checkExistinArray('order', $data)) {
            $orderColumn = $data['order'][0]['column'];
            $orderDirection = $data['order'][0]['dir'];
    
            $orderColumns = ['id', 'name', 'email', 'phone_number', 'dealership_name', 'dealership_name', 'adf_mail','created_at'];
    
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
