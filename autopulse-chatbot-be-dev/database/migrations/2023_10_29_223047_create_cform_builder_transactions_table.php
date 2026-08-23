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
        Schema::create('cforms', function (Blueprint $table) {
            $table->id();
            $table->integer('page_id')->default(0);
            $table->foreignId('form_id')->nullable(false)->constrained('cform_builders')->onDelete('cascade');
            $table->JSON('form')->nullable(false);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('cforms');
    }
};
