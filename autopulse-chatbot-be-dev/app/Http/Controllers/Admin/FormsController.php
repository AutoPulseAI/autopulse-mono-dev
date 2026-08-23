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

class FormsController extends Controller
{
    
    public function read(Request $request)
    {
        $item = FormBuilder::findOrFail($request->id);
        //dd($item->toArray());
        return $item;
    }

    public function sections(Request $request)
    {
        $forms = FormBuilder::findOrFail($request->id);
        return view('backend.sections.index',compact('forms'));
    }

    public function create(Request $request)
    {
        $request->request->remove('_token');
        $form = Forms::where('form_id', $request->form_id)->first();

        if( $form )
        {
            $item = Forms::findOrFail($form->id);
            
        }else{
            $item = new Forms();
        }

        $item->form_id = $request->form_id;
        $item->page_id = $request->page;
        //$item->section_id = $request->section;
        //$request->request->remove('form_id');
        //$request->request->remove('page');

        $daytime = date('dmyHis');

        if($_FILES)
        {
            $files = array();
            $i = 0;
            foreach($_FILES as $key => $value)
            {
                
                if( $request->file($key) ) {
                   /* $image = 'file-'.$daytime.'-'.$i++.'.'.$request->file($key)->getClientOriginalExtension();
                    $request->file($key)->move(public_path('images/'), $image);
                    $image_path = 'images/'.$image;
                    $files[$key] =  $image_path;

                    $file = $request->file('file');
                    $daytime = date('dmyHis');*/
        
                    $file = $request->file($key);
                    $fileName = 'image-'.$daytime.'-'.$i++.'.'.$file->getClientOriginalExtension();
                    $t = Storage::disk('s3')->put($fileName, file_get_contents($file), 'images');
                    $image_path = Storage::disk('s3')->url($fileName);
                    $files[$key] =  $image_path;
                }
                else{
                    if( isset($item->form[$key]) )
                    {
                        $files[$key] =  $item->form[$key];
                    }else{
                        $files[$key] = '';
                    }
                }

            }

            $item->form = array_merge($request->all(), $files);

        }else{
            $item->form = $request->all();
        }
        
        

        $item->save();

        return redirect()->route('pages.edit',$request->page)->with('status','Updated successfully.')->with('tab',$request->form_id);
    }
}
