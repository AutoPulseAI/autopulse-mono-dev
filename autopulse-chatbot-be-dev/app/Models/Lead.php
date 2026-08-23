<?php 
namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;


class Lead extends Model
{
    use HasFactory;
    /**
     * The attributes that are mass assignable.
     *
     * @var array<int, string>
     */
    protected $table = 'offer';
    
    protected $fillable = [
        'user_id',
        'offer_price',
        'vin',
        'vid',
        'dealer_id',
        'dealer_external_id',
        'dealer_source',
        'viewed',
        'store_id',
        'make',
        'model',
        'trim',
        'transmission',
        'drivetrain',
        'price',
        'year',
        'engine',
        'body_type',
        'miles',
        'feature_image',
         'car_type',
    ];


    /**
     * Get the user that owns the lead.
     *
     * @return \Illuminate\Database\Eloquent\Relations\BelongsTo
     */
    public function user()
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    /**
     * Get the dealer that owns the lead.
     *
     * @return \Illuminate\Database\Eloquent\Relations\BelongsTo
     */
    public function dealer()
    {
        return $this->belongsTo(Dealer::class, 'dealer_id');
    }


    public function scopeMakeQuery($query, $data)
    {
        $model = $this->query()->with('user', 'dealer');

        // Check for specific ID
        if ($this->checkExistinArray('id', $data)) {
            $model = $model->where('id', $data['id']);
        }
        if ($this->checkExistinArray('from', $data) && $this->checkExistinArray('to', $data)) {
            $model = $model->whereBetween('created_at', [$data['from'], $data['to']]);
        } elseif ($this->checkExistinArray('from', $data)) {
            $model = $model->where('created_at', '>=', $data['from']);
        } elseif ($this->checkExistinArray('to', $data)) {
            $model = $model->where('created_at', '<=', $data['to']);
        }

        // Search functionality
        if ($this->checkExistinArray('search', $data)) {
            $searchValue = $data['search']['value'];
            if ($searchValue) {
                $model = $model->where(function($query) use ($searchValue) {
                    $query->where('vin', 'LIKE', "%{$searchValue}%")->orWhere('dealer_source', 'LIKE', "%{$searchValue}%")
                        ->orWhereHas('user', function($q) use ($searchValue) {
                            $q->where('name', 'LIKE', "%{$searchValue}%");
                               
                        })
                       ;;
                });
            }
        }

        // Ordering functionality
        if ($this->checkExistinArray('order', $data)) {
            $orderColumn = $data['order'][0]['column'];
            $orderDirection = $data['order'][0]['dir'];

            // Define orderable columns
            $orderColumns = [
                'id', 
                'vin', 
                'user.name', 
                'user.last_name', 
                'dealer.name', 
                'dealer.phone_number', 
                'dealer_source', 
                'created_at'
            ];

            // Ensure the column exists in the array
            $orderBy = isset($orderColumns[$orderColumn]) ? $orderColumns[$orderColumn] : 'id';

            // Handle nested relationships
            if (strpos($orderBy, '.') !== false) {
                $orderBy = str_replace('.', '->', $orderBy);
            }

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
