@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">
<!-- Page Content Start -->
<div class="position-relative">
    <div class="row">
        <div class="col col-12">
            <div class="page_title mb-2">
                <h2 class="mb-0">Page</h2>
            </div>
        </div>
    </div>
    @if(session()->has('success'))
        <div class="row">
            <div class="alert alert-success alert-dismissible text-white" role="alert">
                <span class="text-sm">{{ Session::get('success') }}</span>
                <button type="button" class="btn-close text-lg py-3 opacity-10"
                    data-bs-dismiss="alert" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
        </div>
    @endif

    <div class="row mt-2">        
        <div class="col col-12">
            <div class="position-relative bg_yellow rounded p-lg-4 p-3">
                <form method='POST' action='{{ route('pages.store') }}' enctype="multipart/form-data">
                    @csrf
                    <div class="row">
                        
                        <div class="mb-3 col-md-6">
                            <label class="form-label">Title <span class="text-danger">*</span></label>
                            <input type="text" name="title" class="form-control border border-2 p-2"  placeholder="Title" value='{{ old('title') }}'>
                            @error('title')
                            <p class='text-danger inputerror'>{{ $message }} </p>
                            @enderror
                        </div>

                        <div class="mb-3 col-md-6">
                            <label class="form-label">Template <span class="text-danger">*</span></label>
                            <select name="template" class="form-control border border-2 p-2">
                                <option value="" disabled>Select Template</option>
                                <option value="about" {{ old('template') == 'about' ? 'selected' : '' }}>About</option>
                                <option value="contact" {{ old('template') == 'contact' ? 'selected' : '' }}>Contact</option>
                                <option value="privacy-policy" {{ old('template') == 'privacy-policy' ? 'selected' : '' }}>Privacy Policy</option>
                                <option value="terms-conditions" {{ old('template') == 'terms-conditions' ? 'selected' : '' }}>Terms & Conditions</option>
                                <option value="faq" {{ old('template') == 'faq' ? 'selected' : '' }}>Faqs</option>
                            </select>
                            @error('template')
                            <p class='text-danger inputerror'>{{ $message }} </p>
                            @enderror
                        </div>

                                                                
                        <div class="mb-3 col-md-6">
                            <label class="form-label">Meta Title </label>
                            <input type="text" name="meta_title" class="form-control border border-2 p-2"  placeholder="Meta Title" value='{{ old('meta_title') }}'>
                            @error('meta_title')
                            <p class='text-danger inputerror'>{{ $message }} </p>
                            @enderror
                        </div>
                        
                        <!--div class="mb-3 col-md-6">
                            <label class="form-label">Meta Image</label>
                            <input type="file" name="meta_image" class="form-control border border-2 p-2" value='{{ old('meta_image') }}'>
                            @error('meta_image')
                                <p class='text-danger inputerror'>{{ $message }} </p>
                            @enderror
                        </div>

                        <div class="mb-3 col-md-12">
                            <label for="floatingTextarea2">Meta Keyword</label>
                            <textarea class="form-control border border-2 p-2"
                                placeholder="Meta Keyword" id="floatingTextarea2" name="meta_keyword"
                                rows="4" cols="50">{{ old('meta_keyword') }}</textarea>
                                @error('meta_keyword')
                                <p class='text-danger inputerror'>{{ $message }} </p>
                                @enderror
                        </div-->
                    
                        <div class="mb-3 col-md-12">
                            <label for="floatingTextarea2" class="form-label">Meta Description</label>
                            <textarea class="form-control border border-2 p-2"
                                placeholder="Meta Description" id="floatingTextarea2" name="meta_desc"
                                rows="4" cols="50">{{ old('meta_desc') }}</textarea>
                                @error('meta_desc')
                                <p class='text-danger inputerror'>{{ $message }} </p>
                                @enderror
                        </div>
                    </div>
                    <div class="row">
                        <div class="col col-12">
                            <div class="position-relative text-center">
                                <button type="submit" class="btn btn_theme">Submit</button>
                            </div>
                        </div>
                    </div>
                </form> 
            </div>
        </div>
    </div>
</div>

@endsection