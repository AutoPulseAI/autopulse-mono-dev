<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Visit extends Model
{
    use HasFactory;
    protected $table = 'visit';
    protected $fillable = [
        'vin',
        'vid',
        'name',
        'source',
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
         'car_type',
         
       
    ];
}
