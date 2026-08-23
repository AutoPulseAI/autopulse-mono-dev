<?php
namespace App\Http\Controllers\Admin;

use App\Models\Plan;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use App\Http\Traits\ApiResponseTrait;
use App\Http\Controllers\Controller;
use  Illuminate\Http\Response;
use Stripe\Stripe;
use Stripe\Product;
use Stripe\Price;

class PlanController extends Controller
{
    use ApiResponseTrait;
    public function index(Request $request)
    {
        $plan = Plan::all();
        return view('template.admin.plan.index',compact('plan'));
    }

    public function storePlan(Request $request)
    {
       $validator = Validator::make($request->all(), [
            
            'name' => 'required|string|max:255',
            'price' => 'required|numeric|min:0',
            'interval' => 'required|in:quater,month,year,day',

        ]);

        if ($validator->fails()){
            $errors = $validator -> errors();
            return $this->respondWithError('errors',$errors ,Response::HTTP_OK); 
            //return redirect()->back()->withErrors($validator); 
        }
        Stripe::setApiKey(env('STRIPE_SECRET'));
        
        $product = Product::create([
            'name' => 'CAR AUTO SUBSCRIPTION ' . $request->name,
        ]);
        #dd($product);
        if($request->interval=='quater'){
            $request->interval_count =3;
            $request->stripe_interval ='month';
        }else{
            $request->interval_count =1;
            $request->stripe_interval =$request->interval;
        }
        //dd($request);
        // Create a Price for that product
        $price = Price::create([
            'product' => $product->id,
            'unit_amount' => $request->price * 100, // converting dollars to cents
            'currency' => 'usd',
            'recurring' => ['interval' => $request->stripe_interval, 'interval_count' => $request->interval_count],
        ]);

        // Save the plan in the local database
        $plan = Plan::create([
            'stripe_plan_id' => $product->id,
            'stripe_price_id' => $price->id,
            'name' => $request->name,
            'price' => $request->price,
            'description' => $request->description,
            'interval' => $request->interval,
            'stripe_interval'=>$request->stripe_interval,
            'interval_count' => $request->interval_count
        ]);
        //dd($plan);
        return $this->respondWithSuccess('success',$plan ,Response::HTTP_OK); 
    }

    public function edit(Plan $plan)
    {
        return view('plans.edit', compact('plan'));
    }

    public function updatePlan(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
        ]);

        if ($validator->fails()){
            $errors = $validator->errors();
            return response()->json(['errors' => $errors], 200); 
        }

        $plan = Plan::findOrFail($request->id);

        // Only update name and description - no Stripe integration for edits
        $plan->update([
            'name' => $request->name,
            'description' => $request->description,
        ]);

        return response()->json(['success' => true, 'message' => 'Plan Updated successfully'], 200);
    }

    public function deletePlan(Request $request)
    {
        $plan = Plan::findOrFail($request->plan_id);

        Stripe::setApiKey(env('STRIPE_SECRET'));
        
        // Delete the Stripe Product first
        try {
            $product = Product::retrieve($plan->stripe_plan_id);
            $product->delete();
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => 'Failed to delete the product from Stripe'], 200);
        }

        // Delete the plan from the local database
        try {
            $plan->delete();
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => 'Failed to delete the plan from the database'], 200);
        }

        return response()->json(['success' => true, 'message' => 'Plan deleted successfully'], 200);
    }
}
