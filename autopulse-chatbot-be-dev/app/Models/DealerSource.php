<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

class DealerSource extends Model
{
    use HasFactory;
    protected $table = 'dealer_source';
    
    protected $fillable = [
        'dealer_id',
        'source',
        'external_dealer_id',
        'adf_mail',
        'email',
        'phone',
        'subscribed',
        'subscripiton_status',
        'dealership_name',
        'is_manage_by_admin',
        'subscription_price',
        'subscription_plan',
        'is_subscribed',
        'cancelled_at',
        'call_tracking_number',
        'call_track_sms',
        'free_trial',
        'free_trial_start_date',
        'free_trial_end_date',
      


    ];

   

    public function dealer()
    {
        return $this->belongsTo(Dealer::class, 'dealer_id');
    }

     // Registering the event listeners
     protected static function boot()
     {
         parent::boot();
 
         // Listen to the saving event to automatically set the geography field
         static::saving(function ($dealerSource) {
             if ($dealerSource->latitude && $dealerSource->longitude) {
                 // Convert latitude and longitude into geography format
                 $dealerSource->location = DB::raw("ST_SetSRID(ST_MakePoint($dealerSource->longitude, $dealerSource->latitude), 4326)");
             }
         });
     }

    public function scopeMakeQuery($query, $data)
    {
        $model = $this->query()->with('dealer');

        if($this->checkExistinArray('id',$data))  $model = $model->where('id',$data['id']);
        if($this->checkExistinArray('dealer_id',$data))  $model = $model->where('dealer_id',$data['dealer_id']);
        if($this->checkExistinArray('is_manage_by_admin',$data))  $model = $model->where('is_manage_by_admin',$data['is_manage_by_admin']);
        if($this->checkExistinArray('is_subscribed',$data))  $model = $model->where('is_subscribed',$data['is_subscribed']);

        // Dynamic search for all columns
        if ($this->checkExistinArray('search', $data)) {
            $searchValue = $data['search']['value'];

            if ($searchValue) {
                $model = $model->where(function ($query) use ($searchValue) {
                    $query->where('id', 'like', '%' . $searchValue . '%')
                        ->orWhereHas('dealer', function($q) use ($searchValue) {
                            $q->where('dealership_group', 'like', '%' . $searchValue . '%');
                        })
                        ->orWhere('dealership_name', 'like', '%' . $searchValue . '%')
                        ->orWhere('source', 'like', '%' . $searchValue . '%')
                        ->orWhere('adf_mail', 'like', '%' . $searchValue . '%')
                        ->orWhere('subscribed', 'like', '%' . $searchValue . '%')
                        ->orWhere('is_manage_by_admin', 'like', '%' . $searchValue . '%')
                        ->orWhere('subscription_price', 'like', '%' . $searchValue . '%')
                        ->orWhere('is_subscribed', 'like', '%' . $searchValue . '%')
                        ->orWhere('cancelled_at', 'like', '%' . $searchValue . '%');
                });
            }
        }

        // Handle ordering
        if ($this->checkExistinArray('order', $data)) {
            $orderColumn = $data['order'][0]['column'];
            $orderDirection = $data['order'][0]['dir'];

            $orderColumns = [
                'id', 'dealership_group', 'dealership_name', 'source',
                'adf_mail', 'subscribed', 'is_manage_by_admin', 'subscription_price',
                'is_subscribed', 'cancelled_at'
            ];

            $orderBy = isset($orderColumns[$orderColumn]) ? $orderColumns[$orderColumn] : 'id';
            $model = $model->orderBy($orderBy, $orderDirection);
        } else {
            $model = $model->orderBy('id', 'desc');
        }

        return $model;
    }

    public function checkExistinArray($key, $data, $default = false)
    {
        return isset($data[$key]) && $data[$key] != '' ? true : $default;
    }

    public  function getNearByDealer($lat, $long, $radius = 50)
    {
        $radiusInMeters = $radius * 1609.34; // Convert miles to meters
        //return null;
        return $this->select('*')
                    ->selectRaw("ST_Distance(location, ST_MakePoint(?, ?)::geography) AS distance", [$long, $lat])
                    ->whereRaw("ST_DWithin(location, ST_MakePoint(?, ?)::geography, ?)", [
                        $long, $lat, $radiusInMeters
                    ])->where('is_subscribed',1)->where(function ($query) {
                        $query->where('cancelled_at', '>', now())
                              ->orWhereNull('cancelled_at');
                    })
                    ->orderByRaw("ST_Distance(location, ST_MakePoint(?, ?)::geography)", [
                        $long, $lat
                    ])
                    ->first();

    }

    public  function getpriorityDealerSource()
    {
      
        //return null;
         $sources = $this->select('*')
       
        ->limit(10) // Limit to latest 10 sources
        ->get()
        ->pluck('source')
        ->toArray();

        return array_unique($sources);
                    

    }

}
