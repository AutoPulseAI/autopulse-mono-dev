<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class CancellationRequest extends Model
{
    use HasFactory;
    protected $fillable = [
        'dealer_id',
        'dealer_source_id',
        'reason',
        'status',
    ];
    public function dealer()
    {
        return $this->belongsTo(Dealer::class, 'dealer_id');
    }

    public function store()
    {
        return $this->belongsTo(DealerSource::class, 'dealer_source_id');
    }

    public function scopeMakeQuery($query, $data)
    {
        $model = $this->query()->with('dealer','store');

        if($this->checkExistinArray('id',$data))  $model = $model->where('id',$data['id']);
        if($this->checkExistinArray('dealer_id',$data))  $model = $model->whereIn('dealer_id',$data['dealer_id']);
       
        // Dynamic search for all columns
        if ($this->checkExistinArray('search', $data)) {
            $searchValue = $data['search']['value'];

            if ($searchValue) {
                $model = $model->where(function ($query) use ($searchValue) {
                    $query->where('id', 'like', '%' . $searchValue . '%')
                        ->orWhereHas('dealer', function($q) use ($searchValue) {
                            $q->where('dealership_group', 'like', '%' . $searchValue . '%');
                        })
                      
                        ->orWhereHas('store', function($q) use ($searchValue) {
                            $q->where('dealership_name', 'like', '%' . $searchValue . '%');
                        })
                        ->orWhere('status', 'like', '%' . $searchValue . '%');
                });
            }
        }

        // Handle ordering
        if ($this->checkExistinArray('order', $data)) {
            $orderColumn = $data['order'][0]['column'];
            $orderDirection = $data['order'][0]['dir'];

            $orderColumns = [
                'id', 'dealership_group', 'dealership_name'
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
