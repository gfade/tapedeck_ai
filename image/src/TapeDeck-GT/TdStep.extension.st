Extension { #name : 'TdStep' }

{ #category : '*TapeDeck-GT' }
TdStep >> gtRequestFor: aView [

	<gtView>
	^ aView textEditor
		  title: 'Request';
		  priority: 20;
		  text: [ self requestText ]
]

{ #category : '*TapeDeck-GT' }
TdStep >> gtResponseFor: aView [

	<gtView>
	^ aView textEditor
		  title: 'Response';
		  priority: 10;
		  text: [ self responseText ]
]

{ #category : '*TapeDeck-GT' }
TdStep >> gtToolsFor: aView [

	<gtView>
	^ aView columnedList
		  title: 'Tools';
		  priority: 15;
		  items: [ self tools ];
		  column: 'Call' text: [ :call | call summary ];
		  column: 'Exec' text: [ :call | call execString ] width: 60;
		  column: 'Error' text: [ :call | call isError printString ] width: 50;
		  column: 'Result' text: [ :call | TdText oneLine: call resultText max: 100 ]
]
