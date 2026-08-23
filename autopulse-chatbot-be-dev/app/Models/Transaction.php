<?php
namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Transaction extends Model
{
    use HasFactory;

    protected $fillable = [
        'dealer_id',
        'store_id',
        'subscription_id',
        'total_amount',
        'discount_amount',
        'coupon_amount',
        'coupon_code',
        'subscription_start_date',
        'subscription_end_date',
        'invoice_id',
        'transaction_type'
    ];

    public function dealer()
    {
        return $this->belongsTo(Dealer::class);
    }

    public function store()
    {
        return $this->belongsTo(DealerSource::class);
    }

    public function subscription()
    {
        return $this->belongsTo(Subscription::class, 'subscription_id');
    }

    public function scopeMakeQuery($query, $data)
    {
        $model = $this->query()->with('dealer','store');

        if ($this->checkExistinArray('id', $data)) {
            $model = $model->where('id', $data['id']);
        }
       
        if ($this->checkExistinArray('dealership_group', $data)) {
            $model = $model->whereHas('store', function ($query) use ($data) {
                $query->where('dealership_name', $data['dealership_group']);
            });
        }
        if ($this->checkExistinArray('search', $data)) {
            $searchValue = $data['search']['value'];

            if ($searchValue) {
                $model = $model->where(function ($query) use ($searchValue) {
                    $query->whereHas('dealer', function ($query) use ($searchValue) {
                        $query->where('name', 'like', '%' . $searchValue . '%')
                          
                            ->orWhere('email', 'like', '%' . $searchValue . '%');
                    })->orWhereHas('store', function ($query) use ($searchValue) {
                        $query->where('dealership_name', 'like', '%' . $searchValue . '%');
                    });
                });
            }
        }
      
        if ($this->checkExistinArray('end_date', $data)) {
            $model = $model->where('created_at', '<=', $data['end_date']);
        }
       
        if ($this->checkExistinArray('transaction_type', $data)) {
            $model = $model->where('transaction_type',  $data['transaction_type']);
        }
        if ($this->checkExistinArray('start_date', $data)) {
            $model = $model->where('created_at', '>=', $data['start_date']);
        }
        if ($this->checkExistinArray('order', $data)) {
            $orderColumn = $data['order'][0]['column'];
            $orderDirection = $data['order'][0]['dir'];

            $orderColumns = [
                'id',
                'total_amount',
                'discount_amount',
                'coupon_amount',
                'subscription_start_date',
                'subscription_end_date',
                'created_at'
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
}

