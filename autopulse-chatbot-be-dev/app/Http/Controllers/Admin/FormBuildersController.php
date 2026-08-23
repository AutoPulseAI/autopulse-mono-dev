<?php

namespace App\Http\Controllers\Admin;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Validator;
use Illuminate\Http\Response;
use App\Http\Traits\ApiResponseTrait;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;
use Illuminate\Support\Facades\Mail;
use App\Models\Page;
use App\Models\Forms;
use App\Models\FormBuilder;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use App\Helpers\Slug;

class FormBuildersController extends Controller
{

    use ApiResponseTrait;

    public function index(Request $request)
    {

        $input= $request->all() ;

        $form_list = FormBuilder::query()->makeQuery($input);
        
        return view('template.admin.FormBuilder.index', compact('form_list'));
    }

    public function tableData(Request $request)
    {
        $request->merge(['page' => (($request->input('start')/ $request->input('length'))+1)]);
        $request->merge(['perPage' => $request->input('length')]);
      
        $this->perPage = $request->input('length', 3);
        $input= $request->all(); 
      
        $data = FormBuilder::query()->makeQuery($input)->paginate(  $this->perPage ); 
          
        return  response()->json([
            'data' => $data->items(),
            'draw' => $request->input('draw'), // Add draw parameter for security (optional)
            'recordsTotal' => $data->total(),
            'recordsFiltered' => $data->total(),
        ]);
    }

    public function create(Request $request)
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'page' => 'required',
        ]);

        $item = new FormBuilder();
        $item->name = $request->name;
        $item->page_id = $request->page;
        $item->content = $request->form;
        $item->save();

        return response()->json('Added successfully');
    }

    public function editData(Request $request)
    {
        return FormBuilder::where('id', $request->id)->first();
    }

    public function update(Request $request)
    {
        $item = FormBuilder::findOrFail($request->id);
        $item->name = $request->name;
        $item->page_id = $request->page;
        $item->content = $request->form;
        $item->update();

        return response()->json('Updated successfully');
    }

    public function delete(Request $request)
    {
        try{
            $validator = Validator::make($request->all(), [
                'form_id'=>'required|exists:form_builders,id',
            ]);
            if ($validator -> fails()){
                $errors = $validator -> errors();
                return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);
            }
            $form = FormBuilder::where('id',$request->form_id)->first()->delete();
            return $this->respondWithSuccess(__( 'Form Deleted Successfully' ), $form,Response::HTTP_OK);
        } catch (\Exception $e){
            DB::rollback();
            return $this->respondWithError('Something Went Wrong !',$e->getMessage(),Response::HTTP_INTERNAL_SERVER_ERROR);
        } 
    }
}
