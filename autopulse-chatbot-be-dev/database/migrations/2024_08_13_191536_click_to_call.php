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
        Schema::create('call_or_click', function (Blueprint $table) {
           
            $table->id();
            $table->string('vin');	
            $table->string('vid');	
            $table->string('source')->nullable();	
            $table->enum('type', ['call', 'sms','blank'])->default('call');
            $table->integer('store_id')->nullable();
            $table->string('dealer_id')->nullable();	
            $table->string('ip')->nullable();	
            $table->string('user_id')->nullable();	
            $table->timestamps();
   
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('call_or_click');
    }
};
