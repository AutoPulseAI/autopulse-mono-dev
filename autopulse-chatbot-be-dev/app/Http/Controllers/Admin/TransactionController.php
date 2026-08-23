<?php

namespace App\Http\Controllers\Admin;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Validator;
//use Illuminate\Http\Response;
use App\Http\Traits\ApiResponseTrait;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;
use Illuminate\Support\Facades\Mail;
use App\Models\Post;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use App\Helpers\Slug;
use App\Jobs\SendDealerVerificationEmail;
use App\Mail\ChangeDealerPasswordMail;
use App\Mail\AdminDealerCredentialMail;
use Illuminate\Support\Facades\Hash;
use App\Models\Dealer;
use App\Models\DealerSource;
use Illuminate\Support\Facades\Response;
use App\Models\Transaction;

class TransactionController extends Controller
{
    use ApiResponseTrait;

    /**
     * Display a listing of dealers.
     *
     * @param Request $request
     * @return \Illuminate\View\View
     */
    public function index(Request $request)
    {
        // $dealer = Dealer::where('parent_id',0)->where('dealership_group','!=' ,NULL)->get();
        // $stores = Store::all(); // Make sure you have the appropriate model
        $dealer = Dealer::all();
        $stores = DealerSource::where('dealer_id','!=',0)->get();

        return view('template.admin.transaction',compact('stores','dealer'));
    }

   
    public function data(Request $request)
    {
        $request->merge(['page' => (($request->input('start') / $request->input('length')) + 1)]);
        $request->merge(['perPage' => $request->input('length')]);
        $this->perPage = $request->input('length', 3);
        $input = $request->all();
        //dd($input,$this->perPage);
        $data = Transaction::makeQuery($input)->paginate( $this->perPage);

        return response()->json([
            'data' => $data->items(),
            'draw' => $request->draw,
            'recordsTotal' => $data->total(),
            'recordsFiltered' => $data->total(),
        ]);
    }

    public function downloadCSV(Request $request)
    {
        $input['start_date'] = $request->input('start_date');
        $input['end_date']  = $request->input('end_date');
        $input['parent_id']  = 0;

        // Get transaction data based on date range
        $transactions = Transaction::query()->makeQuery($input)->get();

        // Define the CSV headers
        $headers = [
            'ID', 'Stripe Subscription ID', 'Transaction Date', 'Dealership Name',
            'Dealership Group', 'Subscription Start Date', 'Subscription End Date',
            'Amount', 'Coupon Amount', 'Subscription Type'
        ];

        // Create a CSV file in memory
        $callback = function() use ($transactions, $headers) {
            $file = fopen('php://output', 'w');
            fputcsv($file, $headers); // Write the headers

            foreach ($transactions as $transaction) {
                $row = [
                    $transaction->id,
                    $transaction->stripe_subscription_id ?? 'N/A', // Assuming there's a Stripe ID field
                    $transaction->created_at->format('Y-m-d'), // Transaction Date
                    $transaction->store->dealership_name ?? 'N/A', // Dealership Name
                    $transaction->dealer->dealership_group ?? 'N/A', // Dealership Group
                    $transaction->subscription_start_date ?? 'N/A', // Subscription Start Date
                    $transaction->subscription_end_date ?? 'N/A', // Subscription End Date
                    $transaction->total_amount ?? 'N/A', // Amount
                    $transaction->coupon_amount ?? 'N/A', // Coupon Amount
                    $transaction->transaction_type == 1 ? 'Automatic' : 'Manual' // Subscription Type
                ];

                fputcsv($file, $row); // Write the row data
            }

            fclose($file); // Close the file
        };

        // Return the response with headers
        return response()->stream($callback, 200, [
            "Content-Type" => "text/csv",
            "Content-Disposition" => "attachment; filename=transactions.csv",
        ]);
    }

    public function add(Request $request)
    {
        

        $validator = Validator::make($request->all(), [
            'store_id' => 'required|exists:dealer_source,id',
            'total_amount' => 'required|numeric',
            
        ]);
        if ($validator->fails()) {
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,200); 
        }
        $transaction = Transaction::create([
            'dealer_id' => DealerSource::find($request->store_id)->dealer_id,
            'store_id' => $request->store_id,
            'total_amount' => $request->total_amount??NULL,
            'coupon_amount' => $request->coupon_amount??NULL,
            'coupon_code' => $request->coupon_code??NULL,
            'subscription_start_date' => $request->subscription_start_date??NULL,
            'subscription_end_date' => $request->subscription_end_date??NULL,
            'transaction_type' => 0,
        ]);

        return response()->json(['success' => true]);
    }

    public function update(Request $request)
    {
        
        $validator = Validator::make($request->all(), [
            'transaction_id' => 'required|exists:transactions,id',
            'store_id' => 'required|exists:dealer_sources,id',
            'total_amount' => 'required|numeric',
            'coupon_amount' => 'required|numeric',
            'coupon_code' => 'required|string',
            'subscription_start_date' => 'required|date',
            'subscription_end_date' => 'required|date',
            'transaction_type' => 'required|in:0,1',
        ]);
        if ($validator->fails()) {
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK); 
        }

        $transaction = Transaction::find($request->transaction_id);
        $transaction->update([
            'store_id' => $request->store_id,
            'total_amount' => $request->total_amount,
            'coupon_amount' => $request->coupon_amount,
            'coupon_code' => $request->coupon_code,
            'subscription_start_date' => $request->subscription_start_date,
            'subscription_end_date' => $request->subscription_end_date,
            'transaction_type' => $request->subscription_type,
        ]);

        return response()->json(['success' => true]);
    }

    public function delete(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'transaction_id' => 'required|exists:transactions,id',
        ]);

        if ($validator->fails()) {
            return response()->json(['success' => false, 'data' => $validator->errors()]);
        }

        Transaction::find($request->transaction_id)->delete();

        return response()->json(['success' => true]);
    }
   

   
    
}
