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
        Schema::create('offer', function (Blueprint $table) {
            $table->id();
            $table->integer('user_id');
            $table->float('offer_price',12,2)->nullable();
            $table->string('vin')->nullable();
            $table->string('vid')->nullable();
            $table->string('dealer_id')->nullable();
            $table->string('dealer_external_id')->nullable();
            $table->string('dealer_source')->nullable();
            $table->integer('viewed')->default(0);
       
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('offer');
    }
};
