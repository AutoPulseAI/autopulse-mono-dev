<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class clickCallSms extends Model
{
    use HasFactory;
    protected $table = 'call_or_click';
    protected $fillable = [
        'vin',
        'vid',
        'name',
        'source',
        'type',
        'dealer_id',
        'ip',
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
        'car_type'
       
    ];
    
}
