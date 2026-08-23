@extends('layouts.admin')
 
@section('content')
<div class="position-relative min-h-100 main_bg min_h_100">
    
    <div class="container-xxl container-fluid">
        <div class="broadcasts_section mx-md-3">
            <div class="row">
                <div class="col col-12">
                    <!-- Page Heading -->
                    <div class="broadcasts_head mb-3">
                        <div class="position-relative me-auto">
                            <h3>Edit Home</h3>
                        </div>
                    </div>
                </div>
            </div>

            <div class="row mb-2">
            <div class="col">
                <nav aria-label="breadcrumb" class="bg-body-tertiary rounded-3">
                <ol class="breadcrumb mb-0">
                    <li class="breadcrumb-item"><a href="{{route('admin.dashboard')}}">Dashboard</a></li>
                    <li class="breadcrumb-item"><a href="{{route('admin.home')}}">Home</a></li>
                    <li class="breadcrumb-item active" aria-current="page">Edit Home</li>
                </ol>
                </nav>
            </div>
            </div>

            <div class="row">
                <!-- Profile Update -->
                <div class="col col-lg-12 col-12 bg-light">
                    <div class="p-4 sm:p-8 bg-white dark:bg-gray-800 shadow sm:rounded-lg">

                        <section>

                            @if (Session::has('success'))
                            <div class="alert alert-success alert-dismissible text-white" role="alert">
                                <span class="text-sm">{{ Session::get('success') }}</span>
                                <button type="button" class="btn-close text-lg py-3 opacity-10"
                                    data-bs-dismiss="alert" aria-label="Close">
                                    <span aria-hidden="true">&times;</span>
                                </button>
                            </div>
                            @endif

                            <form method="POST" action="{{ route('admin.updateHome') }}" enctype="multipart/form-data">
                                @csrf
                                <div class="row">
                                @if(isset($home['id']))

                                @php $id = $home['id']; @endphp

                                @else

                                @php $id = ''; @endphp

                                @endif

                                <input type="hidden" name="id" value="{{ old('id',$id) }}">

                                <header class="p-3">
                                    <h5 class="text-lg font-medium text-gray-900 dark:text-gray-100">
                                        Home Page Banner Ads
                                    </h5>

                                </header>

                                <div class="col col-lg-12 col-md-12 col-12 p-3">
                               
                                    @if(isset($home['ads1']))

                                        @php $ads1 = $home['ads1']; @endphp

                                    @else

                                        @php $ads1 = ''; @endphp

                                    @endif

                                    <label class="block font-medium text-sm text-gray-700 dark:text-gray-300" for="ads1">
                                    Banner 1 Ad (728px x 90px)
                                    </label>
                                    <textarea id="ads1" type="text" class="form-control @error('ads1') is-invalid @enderror border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 rounded-md shadow-sm block mt-1 w-full" 
                                    name="ads1" required autocomplete="ads1" autofocus>{{ old('ads1',$ads1) }}</textarea>
                                    @error('ads1')
                                        <span class="invalid-feedback" role="alert">
                                            <strong>{{ $message }}</strong>
                                        </span>
                                    @enderror
                                </div>

                                <div class="col col-lg-12 col-md-12 col-12 p-3">
                               
                                    @if(isset($home['ads2']))

                                        @php $ads2 = $home['ads2']; @endphp

                                    @else

                                        @php $ads2 = ''; @endphp

                                    @endif

                                    <label class="block font-medium text-sm text-gray-700 dark:text-gray-300" for="ads2">
                                    Banner 2 Ad (728px x 90px)
                                    </label>
                                    <textarea id="ads2" type="text" class="form-control @error('ads2') is-invalid @enderror border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 rounded-md shadow-sm block mt-1 w-full" 
                                    name="ads2" required autocomplete="ads2" autofocus>{{ old('ads2',$ads2) }}</textarea>
                                    @error('ads2')
                                        <span class="invalid-feedback" role="alert">
                                            <strong>{{ $message }}</strong>
                                        </span>
                                    @enderror
                                </div>

                                <div class="col col-lg-12 col-md-12 col-12 p-3">
                                    
                                    @if(isset($home['ads3']))

                                        @php $ads3 = $home['ads3']; @endphp

                                    @else

                                        @php $ads3 = ''; @endphp

                                    @endif

                                    <label class="block font-medium text-sm text-gray-700 dark:text-gray-300" for="ads3">
                                    Banner 3 Ad (728px x 90px)
                                    </label>
                                    <textarea id="ads3" type="text" class="form-control @error('ads3') is-invalid @enderror border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 rounded-md shadow-sm block mt-1 w-full" 
                                    name="ads3" required autocomplete="ads3" autofocus>{{ old('ads3',$ads3) }}</textarea>
                                    @error('ads3')
                                        <span class="invalid-feedback" role="alert">
                                            <strong>{{ $message }}</strong>
                                        </span>
                                    @enderror
                                </div>


                                <header class="p-3">
                                    <h5 class="text-lg font-medium text-gray-900 dark:text-gray-100">
                                        Car Listing Page Ads
                                    </h5>
                                </header>


                                <div class="col col-lg-12 col-md-12 col-12 p-3">
                                    
                                    @if(isset($home['ads4']))

                                        @php $ads4 = $home['ads4']; @endphp

                                    @else

                                        @php $ads4 = ''; @endphp

                                    @endif

                                    <label class="block font-medium text-sm text-gray-700 dark:text-gray-300" for="ads4">
                                    Card Ad (300px x 250px)
                                    </label>
                                    <textarea id="ads4" type="text" class="form-control @error('ads4') is-invalid @enderror border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 rounded-md shadow-sm block mt-1 w-full" 
                                    name="ads4" required autocomplete="ads4" autofocus>{{ old('ads4',$ads4) }}</textarea>
                                    @error('ads4')
                                        <span class="invalid-feedback" role="alert">
                                            <strong>{{ $message }}</strong>
                                        </span>
                                    @enderror
                                </div>


                                <div class="col col-lg-12 col-md-12 col-12 p-3">
                                    
                                    @if(isset($home['ads5']))

                                        @php $ads5 = $home['ads5']; @endphp

                                    @else

                                        @php $ads5 = ''; @endphp

                                    @endif

                                    <label class="block font-medium text-sm text-gray-700 dark:text-gray-300" for="ads5">
                                    Banner Ad (728px x 90px)
                                    </label>
                                    <textarea id="ads5" type="text" class="form-control @error('ads5') is-invalid @enderror border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 rounded-md shadow-sm block mt-1 w-full" 
                                    name="ads5" required autocomplete="ads5" autofocus>{{ old('ads5',$ads5) }}</textarea>
                                    @error('ads5')
                                        <span class="invalid-feedback" role="alert">
                                            <strong>{{ $message }}</strong>
                                        </span>
                                    @enderror
                                </div>


                                <header class="p-3">
                                    <h5 class="text-lg font-medium text-gray-900 dark:text-gray-100">
                                        Car Details Page Ads
                                    </h5>
                                </header>

                                <div class="col col-lg-12 col-md-12 col-12 p-3">
                                    
                                    @if(isset($home['ads6']))

                                        @php $ads6 = $home['ads6']; @endphp

                                    @else

                                        @php $ads6 = ''; @endphp

                                    @endif

                                    <label class="block font-medium text-sm text-gray-700 dark:text-gray-300" for="ads6">
                                    Verticle Ad (250px x 500px)
                                    </label>
                                    <textarea id="ads6" type="text" class="form-control @error('ads6') is-invalid @enderror border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 rounded-md shadow-sm block mt-1 w-full" 
                                    name="ads6" required autocomplete="ads6" autofocus>{{ old('ads6',$ads6) }}</textarea>
                                    @error('ads6')
                                        <span class="invalid-feedback" role="alert">
                                            <strong>{{ $message }}</strong>
                                        </span>
                                    @enderror
                                </div>


                                <div class="d-flex justify-content-between mt-4">

                                    <button type="submit" class="btn btn-primary">
                                        {{ __('Save') }}
                                    </button>

                                </div>
                            </div>

                            </form>

                        </section>

                    </div>
                </div>

            </div>

        </div>
    </div>
    
</div>
@endsection

@push ('after-scripts')

@endpush
