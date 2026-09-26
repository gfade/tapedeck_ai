"Serve a runner store from the image on http://127.0.0.1:4778 (TdServer, INTERFACES.md §7).

Loads TapeDeck first unless the image already has it (like load.st). The store is the first
argument that is not a .st file or an option, else $TAPEDECK_HOME, else ./store. The port is
$TAPEDECK_IMAGE_PORT, else 4778. The store is refreshed every $TAPEDECK_REFRESH seconds
(default 5, 0 turns it off). In a headless image the script then waits for ever.

	pharo TapeDeck.image st image/scripts/serve.st /abs/store"

| environment candidates source group |
(Smalltalk globals includesKey: #TdServer) ifFalse: [
	environment := Smalltalk os environment.
	candidates := OrderedCollection new.
	(environment at: 'TAPEDECK_SRC' ifAbsent: [ nil ]) ifNotNil: [ :path | candidates add: path asFileReference ].
	candidates
		add: FileSystem workingDirectory / 'image' / 'src';
		add: FileSystem workingDirectory / 'src';
		add: FileLocator imageDirectory asFileReference parent / 'src'.
	source := candidates detect: [ :each | (each / 'BaselineOfTapeDeck') isDirectory ] ifNone: [ nil ].
	source ifNil: [
		Stdio stderr nextPutAll: 'TapeDeck sources not found: set TAPEDECK_SRC to .../tapedeck/image/src'; lf; flush.
		Smalltalk exit: 1 ].
	group := environment at: 'TAPEDECK_GROUP' ifAbsent: [
		(Smalltalk globals includesKey: #GtPhlowView) ifTrue: [ 'gt' ] ifFalse: [ 'default' ] ].
	Metacello new
		baseline: 'TapeDeck';
		repository: 'tonel://' , source fullName;
		onConflictUseIncoming;
		onWarningLog;
		load: group ].
!

| environment arguments home port refresh store server |
environment := Smalltalk os environment.
arguments := Smalltalk arguments reject: [ :each | (each endsWith: '.st') or: [ each beginsWith: '-' ] ].
home := arguments
	ifEmpty: [ environment at: 'TAPEDECK_HOME' ifAbsent: [ (FileSystem workingDirectory / 'store') fullName ] ]
	ifNotEmpty: [ arguments first ].
home asFileReference isDirectory ifFalse: [
	Stdio stderr nextPutAll: 'No runner store at ' , home; lf; flush.
	Smalltalk exit: 1 ].
port := (environment at: 'TAPEDECK_IMAGE_PORT' ifAbsent: [ nil ])
	ifNil: [ TdServer defaultPort ]
	ifNotNil: [ :text | text asNumber ].
refresh := ((environment at: 'TAPEDECK_REFRESH' ifAbsent: [ nil ]) ifNil: [ '5' ]) asNumber.
store := TdStore fromDirectory: home.
server := [ TdServer startOn: store port: port ]
	on: Error
	do: [ :error |
		Stdio stderr nextPutAll: error messageText asString; lf; flush.
		Smalltalk exit: 1 ].
refresh > 0 ifTrue: [
	[ [ (Delay forSeconds: refresh) wait.
	    [ store refresh ] on: Error do: [ :error |
		    Stdio stderr nextPutAll: 'refresh failed: ' , error messageText asString; lf; flush ] ] repeat ]
		forkAt: Processor userBackgroundPriority
		named: 'TapeDeck store refresh' ].
Stdio stdout
	nextPutAll: 'TapeDeck serves ' , store size printString , ' runs of ' , home asFileReference fullName , ' on ' , server url;
	lf;
	flush.
((Smalltalk respondsTo: #isHeadless) and: [ Smalltalk isHeadless ]) ifTrue: [ Semaphore new wait ].
