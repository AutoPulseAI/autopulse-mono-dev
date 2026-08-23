<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::connection('secondary_db')->create('conversion_bookings', function (Blueprint $table) {
            $table->id();
            $table->string('conversion_id');
            $table->date('booking_date')->nullable();
            $table->time('booking_time')->nullable();
            $table->string('phone')->nullable(); 
            $table->string('email')->nullable();
            $table->string('name')->nullable();
            $table->integer('dealer_id')->nullable();
            $table->integer('user_id');
            $table->timestamps();
        });
        Schema::connection('secondary_db')->create('bot_click_action', function (Blueprint $table) {
            $table->id();
            $table->string('conversion_id');
            $table->string('action');
            $table->integer('user_id')->nullable(); 
            $table->text('otherdetail')->nullable();
            $table->text('vin')->nullable();
            $table->text('source')->nullable();
            $table->timestamps();
        });
       
       
      
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::connection('secondary_db')->dropIfExists('conversion_bookings');
        
        Schema::connection('secondary_db')->dropIfExists('bot_click_action');
       
    }
};
